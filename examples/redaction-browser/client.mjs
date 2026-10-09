import { createResourceClient } from '@hachej/boring-files/remote';
import { readJsonBody } from '@hachej/boring-files/request-guard';
import { locator, reference, parsePublicationResult } from '@hachej/boring-files/publication';
import { validatePreparationLayout } from './preparation-composition.mjs';
import { parsePreparation, preparationTargets, preparationDeliveryOperation } from '../redaction/preparation-schema.mjs';
import { actorSnapshot, requestSnapshot, paths, encode, equal } from '../redaction/bindings.mjs';
import { domainPaths, expectation, change, checkedPublication, correctionRequestTarget } from '../redaction/adoption-bindings.mjs';

const subjects = ['A', 'B', 'C'];
const unknown = operationId => ({ kind: 'unknown', ...(operationId ? { operationId } : {}), reason: 'Original operation evidence is unconfirmed' });
export function createRedactionBrowserClient({ origin, identity, fetch: transport }) {
  const actor = Object.freeze(actorSnapshot(identity));
  let configuration;
  async function call(path, input = {}, signal) {
    const response = await transport(new Request(new URL(path, origin), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), redirect: 'error', signal }));
    if (response.status === 403) return { kind: 'denied', reason: 'Current host access refused' };
    if (response.status !== 200 || response.redirected) throw new Error('Host response unconfirmed');
    return readJsonBody(response, 1048576, signal);
  }
  const resource = path => createResourceClient({ identity: actor, endpoint: new URL(path, origin), publication: true, reconciliation: true, fetch: transport });
  async function configure() {
    const result = await call('/configuration');
    if (result.kind !== 'available') return result;
    if (!equal(result.identity, actor) || !Array.isArray(result.consultations) || result.consultations.length !== 2) throw new TypeError('Invalid consultation configuration');
    for (const [index, entry] of result.consultations.entries()) {
      if (entry.id !== ['first', 'second'][index] || typeof entry.title !== 'string' || typeof entry.instanceId !== 'string' || !entry.instanceId) throw new TypeError('Invalid consultation');
      if (!equal(locator(entry.notesTarget), paths(entry.instanceId, 'A').source)) throw new TypeError('Wrong notes target');
      const prepared = preparationTargets(entry.instanceId);
      if (!equal(locator(entry.preparation.outputTarget), prepared.output) || !equal(locator(entry.preparation.layoutTarget), prepared.layout)) throw new TypeError('Wrong preparation targets');
      for (const subject of subjects) for (const key of ['letters', 'records']) if (!equal(locator(entry[key][subject]), domainPaths(entry.instanceId, subject)[key === 'letters' ? 'letter' : 'record'])) throw new TypeError('Wrong domain target');
    }
    configuration = structuredClone(result); return structuredClone(configuration);
  }
  function consultation(id) {
    const config = configuration?.consultations.find(entry => entry.id === id);
    if (!config) throw new TypeError('Configuration must be authorized first');
    const prefix = `/consultations/${id}`, proposals = new Map(), adoptions = new Map(), corrections = new Map();
    const ref = (value, request, adoption = false) => {
      if (!value || value.instanceId !== config.instanceId || value.subject !== request.subject || value.requestId !== request.requestId || !equal(value.actor, actor)) throw new TypeError('Wrong native owner');
      if (adoption) {
        if (!Number.isSafeInteger(value.taskId) || value.operationId !== JSON.stringify(['fictional.redaction.adopt.v1', config.instanceId, request.subject, request.requestId])) throw new TypeError('Wrong adoption binding');
      } else {
        const root = `${config.instanceId}/${request.subject}/`;
        if (!value.generationId || !equal(locator(reference(value.reservation)), { resource: { providerId: 'redaction', path: `${root}requests/${request.requestId}.json` }, view: { kind: 'published' } }) || !equal(locator(reference(value.guard)), paths(config.instanceId, request.subject).generation)) throw new TypeError('Wrong native reservation');
        if (value.operationId !== JSON.stringify([`fictional.redaction:${config.instanceId}`, value.delivery])) throw new TypeError('Wrong delivery operation');
        for (const field of ['producer', 'delivery', 'validation', 'formatter']) if (!Number.isSafeInteger(value[field]) || value[field] < 1) throw new TypeError('Missing native task');
      }
      return structuredClone(value);
    };
    const invoke = async (route, entry, input, validate) => {
      const uncertain = entry.uncertain;
      try {
        const result = await call(`${prefix}/${route}`, input);
        const checked = await validate(result);
        if (uncertain && !['admitted', 'committed'].includes(checked.kind)) return unknown(entry.operationId);
        entry.uncertain = ['unknown', 'reserved'].includes(checked.kind); return checked;
      } catch { entry.uncertain = true; return unknown(entry.operationId); }
    };
    const ownedProposal = value => {
      const entry = proposals.get(value?.requestId);
      if (!entry?.ref || !equal(value, entry.ref)) throw new TypeError('Unrecognized proposal reference');
      return entry;
    };
    async function capture(input) {
      try {
        const result = await call(`${prefix}/capture`, structuredClone(input));
        if (result.kind !== 'captured') return result;
        const request = requestSnapshot(result.request, config.instanceId);
        if (request.subject !== input.subject || request.requestId !== input.requestId || !equal(request.source, input.source)) throw new TypeError('Wrong selected capture');
        return { kind: 'captured', request };
      } catch { return { kind: 'unavailable', reason: 'Selected source capture unconfirmed' }; }
    }
    async function admit(input) {
      let request; try { request = requestSnapshot(input, config.instanceId); } catch { return { kind: 'denied' }; }
      let entry = proposals.get(request.requestId);
      if (entry && !equal(entry.request, request)) return { kind: 'denied', reason: 'Original request retained' };
      if (!entry) { entry = { request, uncertain: false }; proposals.set(request.requestId, entry); }
      return invoke('admit', entry, entry.request, result => {
        if (result.kind === 'admitted') { entry.ref = ref(result.ref, entry.request); return { kind: 'admitted', ref: entry.ref }; }
        if (!['unknown', 'reserved', 'denied', 'conflict', 'unavailable'].includes(result.kind)) throw new TypeError('Invalid admission');
        return result;
      });
    }
    async function view(value) {
      let entry; try { entry = ownedProposal(value); } catch { return { kind: 'denied' }; }
      const sequence = (entry.viewSequence ?? 0) + 1; entry.viewSequence = sequence;
      try {
        const result = await call(`${prefix}/view`, value);
        if (result.kind !== 'ready') return result;
        if (!result.catalog || !Array.isArray(result.value?.items) || result.value.items.length > 2 || !Array.isArray(result.corrections)) throw new TypeError('Invalid semantic proposal');
        const ids = Object.values(result.catalog);
        if (ids.some(itemId => typeof itemId !== 'string' || !/^[0-9a-f-]{36}$/.test(itemId)) || new Set(ids).size !== ids.length || result.value.items.some(item => !ids.includes(item.itemId) || typeof item.text !== 'string' || encode(item.text).length > 4096)) throw new TypeError('Invalid item association');
        for (const slot of result.corrections) {
          if (!ids.includes(slot.itemId)) throw new TypeError('Wrong correction item');
          expectation(slot.expected, domainPaths(config.instanceId, entry.request.subject, slot.itemId).correction);
          if (slot.value && (slot.value.itemId !== slot.itemId || typeof slot.value.text !== 'string' || encode(slot.value.text).length > 4096)) throw new TypeError('Wrong correction content');
        }
        if (entry.viewSequence === sequence) entry.review = structuredClone(result); return structuredClone(result);
      } catch { return { kind: 'unavailable', reason: 'Proposal evidence unconfirmed' }; }
    }
    async function correct(input) {
      let entry, publication, key;
      try {
        entry = ownedProposal(input.ref); entry.viewSequence = (entry.viewSequence ?? 0) + 1; const options = structuredClone(input.options);
        key = options.requestId; const targets = domainPaths(config.instanceId, input.ref.subject, options.itemId);
        const original = { requestId: options.requestId, itemId: options.itemId, expected: expectation(options.expected, targets.correction), text: options.text };
        const record = { actor, proposal: input.ref, ...original };
        publication = { operationId: JSON.stringify(['fictional.redaction.correct.v1', config.instanceId, input.ref.subject, key]), atomicity: 'all-or-nothing', changes: [change({ kind: 'absent', target: correctionRequestTarget(config.instanceId, input.ref.subject, key) }, record, 'application/json'), change(original.expected, { itemId: original.itemId, text: original.text, basedOnProposal: input.ref.validation }, 'application/json')] };
        const retained = corrections.get(key);
        if (retained && !equal(retained.input, input)) return { kind: 'denied' };
        if (!retained) corrections.set(key, { input: structuredClone(input), publication, operationId: publication.operationId });
        entry = corrections.get(key);
      } catch { return { kind: 'denied' }; }
      return invoke('correct', entry, entry.input, result => checkedPublication(result, entry.publication, actor));
    }
    async function captureAdoption(input) {
      try {
        const proposal = ownedProposal(input.ref), review = proposal.review;
        if (!review || input.corrections.some(slot => !equal(slot.expected, review.corrections.find(candidate => candidate.itemId === slot.itemId)?.expected))) return { kind: 'denied', reason: 'Exact reviewed correction evidence required' };
        const result = await call(`${prefix}/capture-adoption`, structuredClone(input));
        if (result.kind !== 'captured') return result;
        const request = result.request;
        if (request.instanceId !== config.instanceId || request.subject !== input.ref.subject || request.requestId !== input.requestId || !equal(request.proposal, input.ref) || !equal(request.choices, input.choices) || !equal(request.corrections, input.corrections) || !equal(request.record, input.record) || !equal(request.letter, input.letter)) throw new TypeError('Wrong adoption capture');
        const items = request.choices.map(choice => {
          const item = choice.kind === 'corrected' ? review.corrections.find(slot => slot.itemId === choice.itemId)?.value : review.value.items.find(item => item.itemId === choice.itemId);
          if (!item) throw new TypeError('Unreviewed item');
          return { itemId: choice.itemId, text: item.text, kind: choice.kind };
        });
        const operationId = JSON.stringify(['fictional.redaction.adopt.v1', config.instanceId, request.subject, request.requestId]);
        const publication = { operationId, atomicity: 'all-or-nothing', preconditions: [{ kind: 'revision', target: proposal.request.source }, { kind: 'revision', target: proposal.request.config }, { kind: 'revision', target: input.ref.guard }, ...request.corrections.map(slot => slot.expected)], changes: [change(request.record, { format: 'fictional.redaction.record', version: 1, subject: request.subject, proposal: input.ref.validation, items }, 'application/json'), change(request.letter, `# Fictional ${request.subject}\n${items.map(item => item.text).join('\n')}`, 'text/markdown')] };
        adoptions.set(request.requestId, { request: structuredClone(request), publication, operationId, uncertain: false });
        return { kind: 'captured', request: structuredClone(request) };
      } catch { return { kind: 'unavailable', reason: 'Reviewed adoption capture unconfirmed' }; }
    }
    async function adopt(request) {
      const entry = adoptions.get(request?.requestId);
      if (!entry || !equal(entry.request, request)) return { kind: 'denied' };
      return invoke('adopt', entry, entry.request, result => {
        if (result.kind === 'admitted') { entry.ref = ref(result.ref, entry.request, true); return { kind: 'admitted', ref: entry.ref }; }
        return result;
      });
    }
    async function adoptionResult(value) {
      const entry = adoptions.get(value?.requestId);
      if (!entry?.ref || !equal(entry.ref, value)) return { kind: 'denied' };
      try {
        const result = await call(`${prefix}/adoption-result`, value);
        if (result.kind === 'pending') return result;
        const checked = await checkedPublication(parsePublicationResult(result), entry.publication, actor);
        if (!['committed', 'conflict'].includes(checked.kind)) { entry.uncertain = true; return unknown(entry.operationId); }
        entry.uncertain = false; return checked;
      } catch { entry.uncertain = true; return unknown(entry.operationId); }
    }
    async function latest(subject) {
      try {
        const result = await call(`${prefix}/latest`, { subject });
        if (['reserved', 'admitted'].includes(result.kind)) {
          const request = requestSnapshot(result.request, config.instanceId);
          if (request.subject !== subject) throw new TypeError('Wrong latest subject');
          const old = proposals.get(request.requestId);
          if (old && !equal(old.request, request)) throw new TypeError('Original request changed');
          const entry = old ?? { request, uncertain: result.kind === 'reserved' };
          if (result.kind === 'admitted') entry.ref = ref(result.ref, request);
          proposals.set(request.requestId, entry);
        }
        return result;
      } catch { return { kind: 'unavailable', reason: 'Latest native observation unconfirmed' }; }
    }
    async function transcribe(input, signal) {
      try {
        const result = await call(`${prefix}/transcribe`, input, signal);
        if (result.kind === 'transcribed' && (result.consultationId !== id || result.requestId !== input.requestId || result.recordingId !== input.recordingId || typeof result.text !== 'string' || encode(result.text).length > 4096 || new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(encode(result.text)) !== result.text)) throw new TypeError('Wrong transcription capture');
        return result;
      } catch { return { kind: 'unavailable', reason: 'Transcription unconfirmed; original capture retained' }; }
    }
    const preparationEntries = new Map(), preparationTargetsForOwner = preparationTargets(config.instanceId);
    const preparationResource = resource(`${prefix}/preparation`);
    const preparationRequest = value => {
      if (!value || Object.keys(value).sort().join(',') !== 'config,dossier,generation,instanceId,notes,output,requestId' || value.instanceId !== config.instanceId || typeof value.requestId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(value.requestId)) throw new TypeError('Invalid preparation request');
      for (const name of ['notes', 'dossier', 'config']) if (!equal(locator(reference(value[name])), preparationTargetsForOwner[name])) throw new TypeError('Wrong preparation source');
      expectation(value.generation, preparationTargetsForOwner.generation); expectation(value.output, preparationTargetsForOwner.output); return structuredClone(value);
    };
    const preparationRef = (value, request) => {
      if (!value || value.instanceId !== config.instanceId || value.requestId !== request.requestId || !equal(value.actor, actor) || !/^[0-9a-f-]{36}$/.test(value.generationId) || value.operationId !== preparationDeliveryOperation(config.instanceId, value.delivery)) throw new TypeError('Wrong preparation native owner');
      if (!equal(locator(reference(value.guard)), preparationTargetsForOwner.generation) || !equal(locator(reference(value.reservation)), { resource: { providerId: 'redaction', path: `${config.instanceId}/preparation/requests/${request.requestId}.json` }, view: { kind: 'published' } })) throw new TypeError('Wrong preparation reservation');
      for (const key of ['producer', 'validation', 'delivery']) if (!Number.isSafeInteger(value[key]) || value[key] < 1) throw new TypeError('Missing preparation native task'); return structuredClone(value);
    };
    const readPreparation = async (input, signal) => {
      const result = await preparationResource.read(input, signal); if (result.kind !== 'available') return result;
      try { const document = parsePreparation(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.snapshot.bytes))); if (result.snapshot.mediaType !== 'application/json' || result.snapshot.bytes.length > 65536 || document.instanceId !== config.instanceId) throw new TypeError('Wrong preparation document'); return result; }
      catch { return { kind: 'unavailable', reason: 'Preparation document evidence unconfirmed' }; }
    };
    const layoutResource = resource(`${prefix}/preparation-layout`);
    const preparation = {
      resource: { read: readPreparation }, layout: { ...layoutResource, read: async (input, signal) => { const result = await layoutResource.read(input, signal); if (result.kind !== 'available') return result; try { if (result.snapshot.mediaType !== 'application/json' || result.snapshot.bytes.length > 32768) throw new TypeError('Invalid layout resource'); validatePreparationLayout(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.snapshot.bytes))); return result; } catch { return { kind: 'unavailable', reason: 'Preparation layout domain invalid; current retained' }; } } },
      capture: async input => { try { const result = await call(`${prefix}/preparation-capture`, input); if (result.kind !== 'captured') return result; const request = preparationRequest(result.request); if (request.requestId !== input.requestId || !equal(request.notes, input.source)) throw new TypeError('Wrong preparation save selection'); return { kind: 'captured', request }; } catch { return { kind: 'unavailable', reason: 'Preparation capture unconfirmed' }; } },
      admit: async input => { let request; try { request = preparationRequest(input); } catch { return { kind: 'denied' }; } let entry = preparationEntries.get(request.requestId); if (entry && !equal(entry.request, request)) return { kind: 'denied' }; if (!entry) { entry = { request, uncertain: false }; preparationEntries.set(request.requestId, entry); } return invoke('preparation-admit', entry, entry.request, result => { if (result.kind === 'admitted') { entry.ref = preparationRef(result.ref, request); return { kind: 'admitted', ref: entry.ref }; } if (!['unknown', 'reserved', 'denied', 'conflict', 'unavailable'].includes(result.kind)) throw new TypeError('Invalid preparation admission'); return result; }); },
      latest: async () => { try { const result = await call(`${prefix}/preparation-latest`); if (['admitted', 'reserved'].includes(result.kind)) { const request = preparationRequest(result.request), old = preparationEntries.get(request.requestId); if (old && !equal(old.request, request)) throw new TypeError('Original preparation changed'); const entry = old ?? { request, uncertain: result.kind === 'reserved' }; if (result.kind === 'admitted') entry.ref = preparationRef(result.ref, request); preparationEntries.set(request.requestId, entry); } return result; } catch { return { kind: 'unavailable', reason: 'Preparation observation unconfirmed' }; } },
      result: async value => { const entry = preparationEntries.get(value?.requestId); if (!entry?.ref || !equal(entry.ref, value)) return { kind: 'denied' }; try { const result = await call(`${prefix}/preparation-result`, value); if (['pending', 'invalid', 'producer-failed'].includes(result.kind)) return { kind: result.kind }; const parsed = parsePublicationResult(result); if (parsed.kind === 'conflict') return parsed; if (parsed.kind !== 'committed') return unknown(value.operationId); const receipt = parsed.receipt; if (receipt.operationId !== value.operationId || ['principalId', 'initiatorId', 'scopeId'].some(key => receipt[key] !== actor[key]) || receipt.changes.length !== 1 || !equal(locator(receipt.changes[0].after), preparationTargetsForOwner.output) || !equal(receipt.changes[0].before, entry.request.output.kind === 'absent' ? null : entry.request.output.target)) return unknown(value.operationId); const read = await readPreparation({ target: receipt.changes[0].after, revision: { kind: 'exact', value: receipt.changes[0].after.revision } }); if (read.kind !== 'available') return unknown(value.operationId); const document = parsePreparation(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(read.snapshot.bytes))); if (document.requestId !== value.requestId || document.generationId !== value.generationId || !equal(document.sources, { notes: entry.request.notes, dossier: entry.request.dossier, config: entry.request.config })) return unknown(value.operationId); const output = entry.request.output; const publication = { operationId: value.operationId, atomicity: 'all-or-nothing', preconditions: [{ kind: 'revision', target: value.guard }, ...['notes', 'dossier', 'config'].map(name => ({ kind: 'revision', target: entry.request[name] }))], changes: [output.kind === 'absent' ? { kind: 'create', target: output.target, expected: { kind: 'absent' }, bytes: read.snapshot.bytes, mediaType: 'application/json' } : { kind: 'replace', target: output.target, bytes: read.snapshot.bytes, mediaType: 'application/json' }] }; return await checkedPublication(parsed, publication, actor); } catch { return unknown(value.operationId); } },
      compose: async (input, signal) => { try { const result = await call(`${prefix}/preparation-compose`, structuredClone(input), signal); if (result.kind === 'composed' && (!equal(result.preparation, input.preparation) || !Array.isArray(result.snapshots) || result.snapshots.length > 64)) throw new TypeError('Wrong composition association'); return result; } catch { return { kind: 'unavailable', reason: 'Composition unavailable; current retained' }; } },
    };
    return { config: structuredClone(config), preparation, notes: resource(`${prefix}/notes`), letters: Object.fromEntries(subjects.map(subject => [subject, resource(`${prefix}/letter-${subject}`)])), records: Object.fromEntries(subjects.map(subject => { const client = resource(`${prefix}/record-${subject}`); return [subject, { read: async (input, signal) => { const result = await client.read(input, signal); if (result.kind !== 'available') return result; try { const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.snapshot.bytes)); if (result.snapshot.mediaType !== 'application/json' || result.snapshot.bytes.length > 32768 || record.format !== 'fictional.redaction.record' || record.version !== 1 || record.subject !== subject || !Number.isSafeInteger(record.proposal) || !Array.isArray(record.items) || record.items.length < 1 || record.items.length > 2 || record.items.some(item => typeof item.itemId !== 'string' || !/^[0-9a-f-]{36}$/.test(item.itemId) || !['proposed', 'corrected'].includes(item.kind) || typeof item.text !== 'string' || encode(item.text).length > 4096)) throw new TypeError('Invalid saved record'); return result; } catch { return { kind: 'unavailable', reason: 'Saved record evidence unconfirmed' }; } } }]; })), capture, admit, view, correct, captureAdoption, adopt, adoptionResult, latest, transcribe };
  }
  return { identity: actor, configuration: configure, consultation };
}
