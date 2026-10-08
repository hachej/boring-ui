import { createPreparationSession } from './preparation-session.mjs';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { textValue } from '../redaction/adoption-bindings.mjs';
import { createActionRequestId } from './action-binding.mjs';
import { randomUUID } from '@hachej/boring-files/platform';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const subjects = ['A', 'B', 'C'];
export const hasLetterDraft = state => state.dirty && !(state.base.kind === 'absent' && state.bufferVersion === 0 && state.text === '');
const unresolved = block => block.generating || block.admitting || block.adopting || ['unknown', 'reserved'].includes(block.outcome?.kind) || block.correction?.result === null || block.correction?.result?.kind === 'unknown' || block.adoption?.result === null || ['unknown', 'admitted', 'pending'].includes(block.adoption?.result?.kind);
const id = () => randomUUID();
const expected = (read, target) => read.kind === 'available' ? { kind: 'revision', target: read.snapshot.ref } : { kind: 'absent', target };
export async function createRedactionBrowserSession(client) {
  const configuration = await client.configuration();
  if (configuration.kind !== 'available') throw new Error('Consultations unavailable');
  const consultations = new Map(), listeners = new Set();
  let page = 0, active = configuration.consultations[0].id, alive = true, state;
  const emit = () => { state = { active, page, consultations: [...consultations.values()], alive }; for (const listener of [...listeners]) listener(); };
  for (const config of configuration.consultations) {
    const api = client.consultation(config.id), read = await api.notes.read({ target: config.notesTarget, revision: { kind: 'latest' } });
    if (read.kind !== 'available') throw new Error('Consultation notes unavailable');
    const notes = createMarkdownController({ identity: configuration.identity, instanceId: id(), epoch: id(), source: { kind: 'saved', snapshot: read.snapshot }, client: api.notes });
    const blocks = {};
    for (const subject of subjects) {
      const letter = await api.letters[subject].read({ target: config.letters[subject], revision: { kind: 'latest' } });
      if (!['available', 'missing'].includes(letter.kind)) throw new Error('Letter unavailable');
      const controller = createMarkdownController({ identity: configuration.identity, instanceId: id(), epoch: id(), source: letter.kind === 'available' ? { kind: 'saved', snapshot: letter.snapshot } : { kind: 'new', target: config.letters[subject] }, client: api.letters[subject] });
      blocks[subject] = { subject, generation: 0, letter: controller, request: null, ref: null, proposal: null, outcome: null, adoption: null, record: await api.records[subject].read({ target: config.records[subject], revision: { kind: 'latest' } }), choices: {} };
    }
    const owner = { config, api, notes, blocks, mounted: null, dictations: [], notice: '' };
    consultations.set(config.id, owner);
    owner.preparation = await createPreparationSession({ owner, identity: configuration.identity, notify: emit, current: () => alive && active === config.id ? `${config.id}:${page}` : null });
  }
  emit();
  const entry = consultationId => { const value = consultations.get(consultationId); if (!alive || !value) throw new Error('Consultation session closed'); return value; };
  async function inspectBlock(value, block) {
    if (!block.ref) return;
    const generation = block.generation, ref = block.ref, inspection = {}; block.inspection = inspection;
    const proposal = await value.api.view(ref);
    const record = await value.api.records[block.subject].read({ target: value.config.records[block.subject], revision: { kind: 'latest' } });
    if (!alive || block.generation !== generation || block.ref !== ref || block.inspection !== inspection) return;
    block.proposal = proposal; block.record = record; emit();
  }
  async function admitBlock(value, block) {
    if (!block.request) return;
    if (block.admitting) return { kind: 'unknown', reason: 'Original admission is pending' };
    const generation = block.generation, request = block.request, attempt = {}; block.admitting = attempt; emit();
    const outcome = await value.api.admit(request);
    if (block.admitting === attempt) block.admitting = null;
    if (!alive || block.generation !== generation || block.request !== request) return outcome;
    block.outcome = outcome;
    if (block.outcome.kind === 'admitted') { block.ref = block.outcome.ref; await inspectBlock(value, block); }
    emit();
    return block.outcome;
  }
  async function generate(selected = subjects) {
    const value = entry(active), selection = value.notes.actions.selection();
    if (selected.some(subject => unresolved(value.blocks[subject]))) { value.notice = 'Reconcile or await the original block operation first'; emit(); return { kind: 'unknown' }; }
    const attempt = {}; for (const subject of selected) value.blocks[subject].generating = attempt;
    const ids = Object.fromEntries(selected.map(subject => [subject, id()]));
    const generations = Object.fromEntries(selected.map(subject => [subject, ++value.blocks[subject].generation]));
    value.notice = 'Saving selected notes'; emit();
    const saved = await value.notes.flush(selection);
    if (saved.kind !== 'saved' || !equal(saved.selection, selection)) { for (const subject of selected) if (value.blocks[subject].generating === attempt) value.blocks[subject].generating = null; value.notice = `No generation admitted: ${saved.kind}`; emit(); return saved; }
    const captures = await Promise.all(selected.map(subject => value.api.capture({ subject, requestId: ids[subject], source: saved.ref, saveOperationId: saved.receipt.operationId })));
    for (const [index, subject] of selected.entries()) {
      const block = value.blocks[subject], capture = captures[index];
      if (!alive || block.generation !== generations[subject]) continue;
      if (block.generating === attempt) block.generating = null;
      if (capture.kind === 'captured') { block.correction = null; block.request = capture.request; block.ref = null; block.proposal = null; block.adoption = null; }
      else { block.outcome = capture; }
    }
    value.notice = 'Original selected notes captured'; emit();
    return Promise.all(selected.map((subject, index) => captures[index].kind === 'captured' && value.blocks[subject].generation === generations[subject] ? admitBlock(value, value.blocks[subject]) : captures[index]));
  }
  async function reload(consultationId = active) {
    const value = entry(consultationId), observed = Object.fromEntries(subjects.map(subject => [subject, value.blocks[subject].generation]));
    for (const subject of subjects) {
      const block = value.blocks[subject], generation = observed[subject];
      if (unresolved(block) || block.generation !== generation) continue;
      const latest = await value.api.latest(subject);
      if (!alive || block.generation !== generation) continue;
      block.outcome = latest;
      if (['admitted', 'reserved'].includes(latest.kind)) block.request = latest.request;
      if (latest.kind === 'admitted') { block.ref = latest.ref; await inspectBlock(value, block); }
      else { const record = await value.api.records[subject].read({ target: value.config.records[subject], revision: { kind: 'latest' } }); if (alive && block.generation === generation) block.record = record; }
    }
    value.notice = 'Latest observed without admission'; emit();
  }
  async function correct(subject, itemId, text) {
    const value = entry(active), block = value.blocks[subject], slot = block.proposal?.corrections.find(slot => slot.itemId === itemId);
    if (!slot || !block.ref) return { kind: 'denied' };
    if (block.correction?.result === null || block.correction?.result?.kind === 'unknown') return { kind: 'unknown', reason: 'Reconcile the original correction first' };
    try { textValue(text); }
    catch { const result = { kind: 'denied', reason: 'Correction must be valid Unicode text within 4096 UTF-8 bytes' }; block.correction = { input: null, result }; emit(); return result; }
    const payload = structuredClone({ ref: block.ref, options: { itemId, expected: slot.expected, text } });
    const generation = block.generation, correction = { input: null, result: null }; block.correction = correction; emit();
    let requestId;
    try { requestId = await createActionRequestId('correct', value.config.id, configuration.identity, payload); }
    catch { const result = { kind: 'denied', reason: 'Correction could not be prepared; no request was dispatched' }; if (alive && generation === block.generation && block.correction === correction) { correction.result = result; emit(); } return result; }
    const input = { ref: payload.ref, options: { ...payload.options, requestId } }; correction.input = input;
    if (!alive || generation !== block.generation || block.correction !== correction) return { kind: 'stale' };
    const result = await value.api.correct(input);
    if (!alive || generation !== block.generation || block.correction !== correction) return result;
    correction.result = result; emit();
    if (block.correction.result.kind === 'committed') await inspectBlock(value, block);
    return block.correction.result;
  }
  async function adopt(subject) {
    const value = entry(active), block = value.blocks[subject], letter = block.letter.getSnapshot();
    if (hasLetterDraft(letter) || letter.save.kind === 'pending' || letter.save.kind === 'settled' && letter.save.result.kind === 'unknown') { block.outcome = { kind: 'conflict', reason: 'Save or discard the letter draft before adoption' }; emit(); return block.outcome; }
    if (block.proposal?.kind !== 'ready' || !['available', 'missing'].includes(block.record.kind)) return { kind: 'unavailable' };
    const choices = block.proposal.value.items.map(item => ({ itemId: item.itemId, kind: block.choices[item.itemId] ?? 'proposed' }));
    if (block.adopting || block.adoption?.result === null || ['unknown', 'admitted', 'pending'].includes(block.adoption?.result?.kind)) return { kind: 'unknown', reason: 'Review the original adoption outcome first' };
    const payload = structuredClone({ ref: block.ref, choices, letter: letter.base, record: expected(block.record, value.config.records[subject]), corrections: choices.map(choice => ({ itemId: choice.itemId, expected: block.proposal.corrections.find(slot => slot.itemId === choice.itemId).expected })) });
    const generation = block.generation, letterSelection = block.letter.actions.selection(), attempt = {}; block.adopting = attempt; emit();
    let requestId;
    try { requestId = await createActionRequestId('adopt', value.config.id, configuration.identity, payload); }
    catch { const result = { kind: 'denied', reason: 'Adoption could not be prepared; no request was dispatched' }; if (block.adopting === attempt) block.adopting = null; if (alive && generation === block.generation) { block.outcome = result; emit(); } return result; }
    if (!alive || generation !== block.generation) { if (block.adopting === attempt) block.adopting = null; return { kind: 'stale' }; }
    const input = { ...payload, requestId };
    const captured = await value.api.captureAdoption(input); if (block.adopting === attempt) block.adopting = null;
    if (!alive || generation !== block.generation) return captured;
    if (!equal(block.letter.actions.selection(), letterSelection) || hasLetterDraft(block.letter.getSnapshot()) || block.letter.getSnapshot().save.kind === 'pending') { block.outcome = { kind: 'conflict', reason: 'Letter changed while capturing adoption' }; emit(); return block.outcome; }
    if (captured.kind !== 'captured') { block.outcome = captured; emit(); return captured; }
    const adoption = { request: captured.request, result: null }; block.adoption = adoption; emit();
    const result = await value.api.adopt(captured.request);
    if (!alive || generation !== block.generation || block.adoption !== adoption) return result;
    adoption.result = result;
    if (block.adoption.result.kind === 'admitted') block.adoption.ref = block.adoption.result.ref;
    emit(); return block.adoption.result;
  }
  async function adoptionResult(consultationId, subject) {
    const value = entry(consultationId), block = value.blocks[subject];
    if (!block.adoption?.ref) return;
    const generation = block.generation, adoption = block.adoption, result = await value.api.adoptionResult(adoption.ref);
    if (!alive || generation !== block.generation || block.adoption !== adoption) return result;
    adoption.result = result;
    if (block.adoption.result.kind === 'committed') {
      const record = await value.api.records[subject].read({ target: value.config.records[subject], revision: { kind: 'latest' } });
      if (!alive || block.generation !== generation || block.adoption !== adoption) return result;
      block.record = record; await block.letter.actions.refresh();
    }
    emit(); return block.adoption.result;
  }
  async function dictate(recordingId = 'fictional-recording') {
    const value = entry(active), tools = value.mounted, target = tools?.getTarget(), ownerPage = page;
    if (!target || target.subject.mode !== 'source') { value.notice = 'Dictation needs the mounted source editor'; emit(); return; }
    const selection = value.notes.actions.selection(), text = value.notes.getSnapshot().text;
    const inspection = await tools.inspect.invoke(target, { expiresAt: Date.now() + 5000 });
    if (inspection.kind !== 'applied' || inspection.value.currentSelection.kind !== 'source' || !equal(selection, inspection.value.selection) || !equal(target, tools.getTarget()) || ownerPage !== page) { value.notice = 'Editor changed before dictation capture'; emit(); return; }
    const capture = { consultationId: value.config.id, controller: value.notes, tools, page: ownerPage, target: structuredClone(target), selection, text, range: structuredClone(inspection.value.currentSelection), requestId: id(), recordingId, status: 'pending', transcript: null, applied: false };
    value.dictations.push(capture); emit(); return transcribe(capture);
  }
  async function transcribe(capture) {
    const value = entry(capture.consultationId);
    if (capture.applied || capture.status === 'pending' && capture.running) return;
    capture.status = 'pending'; capture.running = true; emit();
    const result = await value.api.transcribe({ requestId: capture.requestId, recordingId: capture.recordingId });
    capture.running = false;
    if (result.kind !== 'transcribed') { capture.status = 'failed'; capture.reason = result.reason ?? result.kind; emit(); return result; }
    capture.transcript = result.text;
    const authorized = await client.configuration().catch(() => ({ kind: 'unavailable' }));
    const current = value.mounted?.getTarget();
    if (!alive || authorized.kind !== 'available' || active !== capture.consultationId || page !== capture.page || value.notes !== capture.controller || value.mounted !== capture.tools || !equal(current, capture.target) || !equal(value.notes.actions.selection(), capture.selection) || value.notes.getSnapshot().text !== capture.text || value.notes.getSnapshot().readOnly) {
      capture.status = 'retained'; capture.reason = 'Original editor target changed or access unavailable; transcript retained for review'; emit(); return result;
    }
    capture.applied = true; capture.status = 'applied';
    value.notes.actions.edit(capture.text.slice(0, capture.range.start) + result.text + capture.text.slice(capture.range.end));
    emit(); return result;
  }
  return {
    client, consultations, getSnapshot: () => state, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    switch: consultationId => { entry(consultationId); consultations.get(active)?.preparation.deactivate(); active = consultationId; page++; emit(); },
    mounted: (consultationId, tools) => { const value = consultations.get(consultationId); if (value) { value.mounted = tools; emit(); } },
    generate, reload, correct, adopt, adoptionResult, dictate, retryDictation: transcribe,
    choose: (subject, itemId, kind) => { entry(active).blocks[subject].choices[itemId] = kind; emit(); },
    retryAdmission: (consultationId, subject) => { const value = entry(consultationId); return admitBlock(value, value.blocks[subject]); },
    refreshProposal: (consultationId, subject) => { const value = entry(consultationId); return inspectBlock(value, value.blocks[subject]); },
    retryCorrection: async (consultationId, subject) => { const value = entry(consultationId), block = value.blocks[subject]; if (!block.correction) return; const generation = block.generation, correction = block.correction, result = await value.api.correct(correction.input); if (generation !== block.generation || block.correction !== correction) return result; correction.result = result; if (block.correction.result.kind === 'committed') await inspectBlock(value, block); emit(); },
    retryAdoption: async (consultationId, subject) => { const value = entry(consultationId), block = value.blocks[subject]; if (!block.adoption) return; const generation = block.generation, adoption = block.adoption, result = await value.api.adopt(adoption.request); if (generation !== block.generation || block.adoption !== adoption) return result; adoption.result = result; if (block.adoption.result.kind === 'admitted') block.adoption.ref = block.adoption.result.ref; emit(); },
    async dispose() { alive = false; page++; for (const value of consultations.values()) { value.mounted = null; await value.preparation.dispose(); value.notes.dispose(); for (const block of Object.values(value.blocks)) block.letter.dispose(); } emit(); listeners.clear(); },
  };
}
