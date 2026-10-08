import { join } from 'node:path';
import { publicationSnapshot, parsePublicationResult, reference } from '@hachej/boring-files/publication';
import { openRedactionFixture, redactionActor } from '../redaction/app.mjs';
import { actorSnapshot, equal, encode } from '../redaction/bindings.mjs';
import { fictionalNotes, fictionalConfig, fictionalTranscript } from './fixtures.mjs';
import { preparationTargets, parsePreparation } from '../redaction/preparation-schema.mjs';
import { preparationLayout, validatePreparationLayout, composePreparation } from './preparation-composition.mjs';

const ids = ['first', 'second'], subjects = ['A', 'B', 'C'];
const denied = () => ({ kind: 'denied', reason: 'Current redaction access denied' });
const unknown = operationId => ({ kind: 'unknown', ...(operationId ? { operationId } : {}), reason: 'Original operation outcome is not confirmed under current access' });
const conflict = () => ({ kind: 'conflict', current: [], reason: 'Selected saved input changed' });
const unavailable = () => ({ kind: 'unavailable', reason: 'Fictional redaction operation unavailable' });
const sameTarget = (a, b) => a?.resource?.providerId === b.resource.providerId && a.resource.path === b.resource.path && a.view?.kind === 'published';
const actorOf = value => actorSnapshot({ principalId: value?.principalId, initiatorId: value?.initiatorId, scopeId: value?.scopeId });
const freezeTarget = value => Object.freeze({ resource: Object.freeze({ ...value.resource }), view: Object.freeze({ ...value.view }) });
const exact = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const requestId = value => typeof value === 'string' && /^[a-z0-9-]{1,80}$/.test(value);

export async function openRedactionBrowser({ directory, policy = () => true, transcribe = async () => fictionalTranscript,
  beforeDocumentPublish, afterDocumentPublish, fixtureOptions = () => ({}) }) {
  const apps = {}, targets = {};
  let closed = false;
  const allowed = (id, actor, action, target) => {
    try { return !closed && ids.includes(id) && policy(id, { ...actor }, action, target ? structuredClone(target) : undefined) === true && !closed; }
    catch { return false; }
  };
  const visible = (id, actor) => allowed(id, actor, 'read', targets[id]?.notes);
  function binding(id, identity) {
    if (!ids.includes(id) || closed) throw new TypeError('Unknown consultation');
    return { app: apps[id], actor: actorOf(identity) };
  }
  async function invoke(id, identity, permission, fn, effect = false) {
    let actor, app;
    try { ({ actor, app } = binding(id, identity)); } catch { return denied(); }
    if (!allowed(id, actor, permission) || !visible(id, actor)) return denied();
    const result = await fn(app, actor);
    return allowed(id, actor, permission) && visible(id, actor) ? result
      : effect && ['committed', 'admitted', 'reserved', 'unknown'].includes(result.kind) ? unknown(result.operationId ?? result.ref?.operationId) : denied();
  }
  try {
    for (const id of ids) {
      const selectedOptions = fixtureOptions(id);
      const app = apps[id] = await openRedactionFixture({ ...selectedOptions, preparation: { ...selectedOptions.preparation, layout: preparationLayout }, directory: join(directory, id), policy: (actor, action, target) => allowed(id, actor, action, target) });
      const preparation = preparationTargets(app.instanceId);
      targets[id] = Object.freeze({ preparation: freezeTarget(preparation.output), 'preparation-layout': freezeTarget(preparation.layout), notes: freezeTarget(app.paths('A').source), ...Object.fromEntries(subjects.flatMap(subject => [[`letter-${subject}`, freezeTarget(app.domainPaths(subject).letter)], [`record-${subject}`, freezeTarget(app.domainPaths(subject).record)]])) });
      const actor = redactionActor(), provider = app.local.provider.workspace(actor.scopeId), changes = [];
      for (const [target, bytes, mediaType] of [[targets[id].notes, encode(fictionalNotes[id]), 'text/markdown'], [app.paths('A').config, encode(fictionalConfig()), 'application/json']]) {
        const saved = await provider.read({ target, revision: { kind: 'latest' } }, actor);
        if (saved.kind === 'missing') changes.push({ kind: 'create', target, expected: { kind: 'absent' }, bytes, mediaType });
        else if (saved.kind !== 'available') throw new Error('Fictional fixture initialization unavailable');
      }
      if (changes.length) {
        const result = await provider.publication.publish({ operationId: `fictional-browser-init-${globalThis.crypto.randomUUID()}`, atomicity: 'all-or-nothing', changes }, actor);
        if (result.kind !== 'committed') throw new Error('Fictional fixture initialization failed');
      }
    }
    function resourceClient(id, resource, identity) {
      const { app, actor } = binding(id, identity), target = targets[id][resource];
      if (!target) throw new TypeError('Unknown editable resource');
      const capturedSignal = identity.signal;
      const access = signal => ({ ...actor, ...(capturedSignal || signal ? { signal: capturedSignal && signal ? AbortSignal.any([capturedSignal, signal]) : capturedSignal ?? signal } : {}) });
      const can = (action, signal) => !access(signal).signal?.aborted && allowed(id, actor, action, target);
      return {
        read: async (input, signal) => {
          const request = structuredClone(input);
          if (!sameTarget(request.target, target) || !can('read', signal)) return denied();
          const result = await app.local.provider.read(request, access(signal));
          if (resource === 'preparation' && result.kind === 'available') {
            try { if (parsePreparation(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.snapshot.bytes))).instanceId !== app.instanceId) return unavailable(); } catch { return unavailable(); }
          }
          if (resource === 'preparation-layout' && result.kind === 'available') {
            try { validatePreparationLayout(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.snapshot.bytes))); } catch { return unavailable(); }
          }
          return can('read', signal) ? result : denied();
        },
        publish: async (input, signal) => {
          if (resource.startsWith('record-') || resource === 'preparation') return denied();
          let request;
          try { request = publicationSnapshot(input); } catch { return denied(); }
          if (request.changes.length !== 1 || request.changes.some(change => !sameTarget(change.target, target) || change.kind === 'delete' || change.mediaType !== (resource === 'preparation-layout' ? 'application/json' : 'text/markdown') || change.bytes.length > (resource === 'preparation-layout' ? 32768 : 4096))
            || request.preconditions?.some(item => !sameTarget(item.target, target))) return denied();
          try {
            const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(request.changes[0].bytes);
            if (resource === 'preparation-layout') validatePreparationLayout(JSON.parse(text), () => allowed(id, actor, 'read', targets[id].preparation) && visible(id, actor));
          } catch { return denied(); }
          if (!can('publish', signal)) {
            const prior = await app.local.provider.workspace(actor.scopeId).reconciliation.lookup(request.operationId, actor);
            return prior.kind === 'not-found' ? denied() : unknown(request.operationId);
          }
          try {
            await beforeDocumentPublish?.({ consultationId: id, target: structuredClone(target), request: structuredClone(request), actor: { ...actor } });
            const result = await app.local.provider.publication.publish(request, access(signal));
            if (result.kind === 'committed') await afterDocumentPublish?.({ consultationId: id, target: structuredClone(target), request: structuredClone(request), actor: { ...actor } });
            return can('publish', signal) && can('read', signal) ? result : unknown(request.operationId);
          } catch { return unknown(request.operationId); }
        },
        lookup: async (operationId, signal) => {
          if (typeof operationId !== 'string' || !operationId || operationId.length > 512) return denied();
          if (!can('read', signal)) return unknown(operationId);
          try {
            const result = await app.local.provider.reconciliation.lookup(operationId, access(signal));
            if (!can('read', signal)) return unknown(operationId);
            return result.kind === 'committed' && result.receipt.changes.some(change => !sameTarget(change.after ?? change.before, target)) ? unknown(operationId) : result;
          } catch { return unknown(operationId); }
        },
      };
    }
    return {
      configuration: async identity => {
        let actor; try { actor = actorOf(identity); } catch { return denied(); }
        if (ids.some(id => !visible(id, actor))) return denied();
        return { kind: 'available', identity: actor, consultations: ids.map(id => ({ id, title: id === 'first' ? 'First fictional consultation' : 'Second fictional consultation', instanceId: apps[id].instanceId, notesTarget: targets[id].notes, preparation: { outputTarget: targets[id].preparation, layoutTarget: targets[id]['preparation-layout'] },
          letters: Object.fromEntries(subjects.map(subject => [subject, targets[id][`letter-${subject}`]])), records: Object.fromEntries(subjects.map(subject => [subject, freezeTarget(apps[id].domainPaths(subject).record)])) })) };
      },
      resourceClient,
      capture: async (id, value, identity) => {
        const input = structuredClone(value);
        if (!exact(input, ['subject', 'requestId', 'source', 'saveOperationId']) || !subjects.includes(input.subject) || !requestId(input.requestId) || typeof input.saveOperationId !== 'string' || input.saveOperationId.length > 512) return denied();
        return invoke(id, identity, 'admit', async (app, actor) => {
          let source, found;
          try { source = reference(input.source); found = parsePublicationResult(await resourceClient(id, 'notes', actor).lookup(input.saveOperationId)); } catch { return unavailable(); }
          if (!sameTarget(source, targets[id].notes) || found.kind !== 'committed') return found.kind === 'unknown' ? found : denied();
          const receipt = found.receipt;
          if (receipt.operationId !== input.saveOperationId || !equal({ principalId: receipt.principalId, initiatorId: receipt.initiatorId, scopeId: receipt.scopeId }, actor)
            || receipt.changes.length !== 1 || !equal(receipt.changes[0].after, source)) return denied();
          const captured = await app.capture(input.subject, input.requestId, actor);
          return captured.kind === 'captured' && !equal(captured.request.source, source) ? conflict() : captured;
        });
      },
      admit: (id, request, actor) => { const input = structuredClone(request); return invoke(id, actor, 'admit', (app, captured) => app.admitProposal(input, captured), true); },
      view: (id, ref, actor) => { const input = structuredClone(ref); return invoke(id, actor, 'read', (app, captured) => app.viewProposal(input, captured)); },
      correct: (id, value, actor) => { const input = structuredClone(value); return invoke(id, actor, 'correct', (app, captured) => app.correctItem(input.ref, input.options, captured), true); },
      captureAdoption: (id, value, actor) => {
        const input = structuredClone(value);
        return invoke(id, actor, 'adopt', async (app, captured) => {
          const result = await app.captureAdoption(input.ref, input.choices, input.requestId, captured);
          return result.kind === 'captured' && (!equal(result.request.letter, input.letter) || !equal(result.request.record, input.record) || !equal(result.request.corrections, input.corrections)) ? conflict() : result;
        });
      },
      adopt: (id, request, actor) => { const input = structuredClone(request); return invoke(id, actor, 'adopt', (app, captured) => app.adopt(input, captured), true); },
      adoptionResult: (id, ref, actor) => { const input = structuredClone(ref); return invoke(id, actor, 'adopt', (app, captured) => app.adoptionResult(input, captured), true); },
      latest: (id, subject, actor) => invoke(id, actor, 'read', (app, captured) => app.latest(subject, captured)),
      preparationCapture: async (id, value, identity) => {
        const input = structuredClone(value);
        if (!exact(input, ['requestId', 'source', 'saveOperationId']) || !requestId(input.requestId) || typeof input.saveOperationId !== 'string' || input.saveOperationId.length > 512) return denied();
        return invoke(id, identity, 'admit', async (app, actor) => {
          let source, found;
          try { source = reference(input.source); found = parsePublicationResult(await resourceClient(id, 'notes', actor).lookup(input.saveOperationId)); } catch { return unavailable(); }
          if (!sameTarget(source, targets[id].notes) || found.kind !== 'committed') return found.kind === 'unknown' ? found : denied();
          const receipt = found.receipt;
          if (receipt.operationId !== input.saveOperationId || !equal({ principalId: receipt.principalId, initiatorId: receipt.initiatorId, scopeId: receipt.scopeId }, actor)
            || receipt.changes.length !== 1 || !equal(receipt.changes[0].after, source)) return denied();
          return app.preparation.capture({ requestId: input.requestId, notes: source }, actor);
        });
      },
      preparationAdmit: (id, value, actor) => { const input = structuredClone(value); return invoke(id, actor, 'admit', (app, captured) => app.preparation.admit(input, captured), true); },
      preparationLatest: (id, actor) => invoke(id, actor, 'read', (app, captured) => app.preparation.latest(captured)),
      preparationResult: (id, value, actor) => { const input = structuredClone(value); return invoke(id, actor, 'read', (app, captured) => app.preparation.result(input, captured), true); },
      preparationCompose: async (id, value, identity, { evaluation = { kind: 'local' }, signal } = {}) => {
        signal ??= new AbortController().signal;
        let actor, app, input;
        try { ({ actor, app } = binding(id, identity)); input = structuredClone(value); if (!exact(input, ['preparation', 'descriptor', 'trigger']) || !['open', 'phase', 'request'].includes(input.trigger)) return denied(); reference(input.preparation); } catch { return denied(); }
        if (!['local', 'fake', 'jev'].includes(evaluation.kind) || typeof evaluation.evaluate !== 'function') return unavailable();
        const permitted = () => !signal?.aborted && visible(id, actor) && allowed(id, actor, 'compose', targets[id].preparation)
          && allowed(id, actor, 'read', targets[id].preparation) && (evaluation.kind !== 'jev' || allowed(id, actor, 'process-composition-metadata', targets[id].preparation));
        const current = async () => {
          if (!permitted()) return denied();
          const read = await app.preparation.read(actor);
          if (!permitted()) return denied();
          if (read.kind !== 'available') return read;
          return equal(read.snapshot.ref, input.preparation) ? read : conflict();
        };
        const initial = await current(); if (initial.kind !== 'available') return initial;
        let refusal;
        try {
          const document = parsePreparation(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(initial.snapshot.bytes)));
          if (document.instanceId !== app.instanceId) return unavailable();
          const snapshots = [], canView = () => permitted();
          const evaluate = async request => {
            const before = await current(); if (before.kind !== 'available') { refusal = before; throw new Error('Preparation composition no longer available'); }
            const response = await evaluation.evaluate(request);
            const after = await current(); if (after.kind !== 'available') { refusal = after; throw new Error('Preparation composition no longer available'); }
            return response;
          };
          for await (const snapshot of composePreparation({ descriptor: input.descriptor, document, trigger: input.trigger, canView, evaluate, signal })) {
            const latest = await current(); if (latest.kind !== 'available') return latest;
            if (snapshot.descriptor) validatePreparationLayout(snapshot.descriptor, canView);
            snapshots.push(snapshot);
          }
          if (refusal) return refusal;
          const latest = await current(); if (latest.kind !== 'available') return latest;
          return { kind: 'composed', preparation: initial.snapshot.ref, snapshots };
        } catch { return refusal ?? (permitted() ? unavailable() : denied()); }
      },
      transcribe: async (id, value, identity, signal) => {
        const input = structuredClone(value);
        if (!exact(input, ['requestId', 'recordingId']) || !requestId(input.requestId) || !requestId(input.recordingId) || signal?.aborted) return denied();
        return invoke(id, identity, 'transcribe', async (_app, actor) => {
          try {
            const text = await transcribe({ consultationId: id, ...input, actor: { ...actor }, signal });
            if (signal?.aborted) return denied();
            if (typeof text !== 'string' || encode(text).length > 4096 || new TextDecoder('utf-8', { ignoreBOM: true }).decode(encode(text)) !== text) return unavailable();
            return { kind: 'transcribed', consultationId: id, ...input, text };
          } catch { return unavailable(); }
        });
      },
      local: { apps, providers: Object.fromEntries(ids.map(id => [id, apps[id].local.provider])) },
      close: async () => { if (closed) return; closed = true; await Promise.all(Object.values(apps).map(app => app.close())); },
    };
  } catch (error) { closed = true; await Promise.all(Object.values(apps).map(app => app.close())); throw error; }
}
