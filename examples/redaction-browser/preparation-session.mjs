import { createExperienceDocumentController } from '@hachej/boring-ui-kit/experience/document';
import { locator } from '@hachej/boring-files/publication';
import { randomUUID } from '@hachej/boring-files/platform';
import { preparationCells, preparationLayout, validatePreparationLayout } from './preparation-composition.mjs';
import { parsePreparation, preparationSlots } from '../redaction/preparation-schema.mjs';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function createPreparationSession({ owner, identity, notify, current }) {
  const api = owner.api.preparation, target = owner.config.preparation.outputTarget;
  const layoutClient = { ...api.layout, read: async (input, signal) => { try { const result = await api.layout.read(input, signal); if (result.kind !== 'available') return result; if (result.snapshot.mediaType !== 'application/json' || result.snapshot.bytes.length > 32768 || !equal(locator(result.snapshot.ref), owner.config.preparation.layoutTarget)) throw new TypeError('Wrong layout source'); validatePreparationLayout(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.snapshot.bytes))); return result; } catch { return { kind: 'unavailable', reason: 'Preparation layout invalid; current retained' }; } } };
  const loaded = await layoutClient.read({ target: owner.config.preparation.layoutTarget, revision: { kind: 'latest' } });
  const layoutAvailable = ['available', 'missing'].includes(loaded.kind);
  let read = { kind: 'missing' }, outcome = null, request = null, ref = null, requestUncertain = false, mount = null, preparing = null, composition = null, offer = null, disposed = false, status = layoutAvailable ? 'Default preparation layout' : 'Preparation layout unavailable; read-only default. Reopen to reacquire layout.', phase = 0, nativeEpoch = 0, observation = null, width = 70, disclosures = [], state;
  const listeners = new Set(), canView = ref => !preparationSlots.some(slot => slot.ref === ref) || !['denied', 'unavailable'].includes(read.kind);
  const controller = createExperienceDocumentController({ identity, instanceId: randomUUID(), epoch: randomUUID(), client: layoutClient, readOnly: !layoutAvailable, cells: preparationCells, canView,
    source: loaded.kind === 'available' ? { kind: 'saved', snapshot: loaded.snapshot } : { kind: 'new', target: owner.config.preparation.layoutTarget, descriptor: preparationLayout } });
  const emit = () => { state = { read, outcome, request, ref, preparing: preparing !== null, requestUncertain, composition: composition !== null, offer, status, phase, width, disclosures }; for (const listener of [...listeners]) listener(); notify(); };
  const unsubscribe = controller.subscribe(emit);
  async function refresh({ composePhase = false } = {}) {
    const capture = {}, observed = phase, epoch = nativeEpoch; session.reading = capture;
    const result = await api.resource.read({ target, revision: { kind: 'latest' } });
    if (disposed || session.reading !== capture || phase !== observed || nativeEpoch !== epoch) return result;
    let next = result;
    if (result.kind === 'available') {
      try { const document = parsePreparation(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.snapshot.bytes))); if (document.instanceId !== owner.config.instanceId || !equal(locator(result.snapshot.ref), target) || request?.requestId === document.requestId && (!equal(document.sources, { notes: request.notes, dossier: request.dossier, config: request.config }) || ref?.requestId === document.requestId && ref.generationId !== document.generationId)) throw new TypeError('Wrong preparation owner'); next = { ...result, document }; }
      catch { next = { kind: 'unavailable', reason: 'Preparation content unconfirmed' }; }
    }
    const changed = next.kind === 'available' && (read.kind !== 'available' || !equal(next.snapshot.ref, read.snapshot.ref));
    read = next;
    if (changed) { phase++; invalidate(); }
    if (['denied', 'unavailable'].includes(read.kind)) invalidate();
    emit();
    if (composePhase && changed && current()) await compose('phase');
    return next;
  }
  function invalidate() { composition?.abort.abort(); composition = null; if (offer) controller.actions.reject(offer.proposalId); offer = null; }
  async function admit(original, epoch) {
    const result = await api.admit(original);
    if (disposed || nativeEpoch !== epoch || request !== original) return result;
    outcome = result; requestUncertain = ['unknown', 'reserved'].includes(outcome.kind);
    if (outcome.kind === 'admitted') ref = outcome.ref;
    emit(); return outcome;
  }
  async function prepare() {
    if (preparing || requestUncertain) return { kind: 'unknown', reason: 'Await or retry the original preparation first' };
    const selection = owner.notes.actions.selection(), requestId = randomUUID(), attempt = {}, epoch = ++nativeEpoch; invalidate(); preparing = attempt; status = 'Saving selected notes for preparation'; emit();
    const saved = await owner.notes.flush(selection);
    if (disposed || nativeEpoch !== epoch) return saved;
    if (saved.kind !== 'saved' || !equal(saved.selection, selection)) { preparing = null; outcome = saved; status = `No preparation admitted: ${saved.kind}`; emit(); return saved; }
    const captured = await api.capture({ requestId, source: saved.ref, saveOperationId: saved.receipt.operationId });
    if (disposed || nativeEpoch !== epoch) return captured;
    if (captured.kind !== 'captured') { preparing = null; outcome = captured; status = `Preparation capture ${captured.kind}`; emit(); return captured; }
    request = captured.request; ref = null; invalidate();
    const result = await admit(request, epoch); if (preparing === attempt) preparing = null; status = `Preparation ${result.kind}`; emit(); return result;
  }
  async function observe() {
    if (preparing) return { kind: 'pending' };
    const capture = {}, epoch = nativeEpoch; observation = capture;
    const latest = await api.latest();
    if (disposed || observation !== capture || nativeEpoch !== epoch) return latest;
    if (requestUncertain && ['admitted', 'reserved'].includes(latest.kind) && !equal(request, latest.request)) { outcome = { kind: 'unknown', reason: 'Original request remains unconfirmed; another preparation is latest' }; emit(); await refresh(); return outcome; }
    if (['admitted', 'reserved'].includes(latest.kind)) {
      request = latest.request; requestUncertain = latest.kind === 'reserved';
      if (latest.kind === 'admitted') ref = latest.ref;
    } else if (requestUncertain) { outcome = { kind: 'unknown', reason: 'Original preparation admission remains unconfirmed' }; emit(); await refresh(); return outcome; }
    outcome = latest; emit();
    if (latest.kind === 'admitted') {
      const originalRef = ref, result = await api.result(originalRef);
      if (disposed || observation !== capture || nativeEpoch !== epoch || ref !== originalRef) return result;
      outcome = result; emit();
    }
    await refresh({ composePhase: true }); return outcome;
  }
  async function compose(trigger = 'request') {
    if (disposed || !current() || read.kind !== 'available') return { kind: 'unavailable', reason: 'Current preparation unavailable' };
    const started = controller.actions.beginRegion(controller.actions.selection(), 'preparation', trigger);
    if (started.kind !== 'applied') { status = `Composition ${started.kind}; current retained`; emit(); return started; }
    composition?.abort.abort();
    const capture = { abort: new AbortController(), page: current(), mount, phase, readRef: structuredClone(read.snapshot.ref), request: started.value };
    composition = capture; offer = null; status = 'Composing preparation; current retained'; emit();
    let result;
    try { result = await api.compose({ preparation: capture.readRef, descriptor: controller.getSnapshot().descriptor, trigger }, capture.abort.signal); }
    catch { result = { kind: 'unavailable' }; }
    if (disposed || composition !== capture) return result;
    composition = null;
    if (capture.abort.signal.aborted || !current() || current() !== capture.page || mount !== capture.mount || phase !== capture.phase || !equal(read.snapshot?.ref, capture.readRef)) { status = 'Composition stale or cancelled; current retained'; emit(); return { kind: 'stale' }; }
    const final = result.kind === 'composed' && result.snapshots.findLast(snapshot => snapshot.kind === 'final');
    if (!final || !equal(result.preparation, capture.readRef)) { if (result.kind === 'denied') read = result; status = `Composition ${result.kind}; current retained`; emit(); return result; }
    try { validatePreparationLayout(final.descriptor, canView); }
    catch { status = 'Composition refused; current retained'; emit(); return { kind: 'denied' }; }
    const proposed = controller.actions.proposeRegion(capture.request, final.descriptor);
    if (proposed.kind === 'proposed') offer = { ...capture, proposalId: proposed.proposalId };
    status = proposed.kind === 'proposed' ? 'Preparation arrangement offered' : `Composition ${proposed.kind}; current retained`; emit(); return proposed;
  }
  async function adopt() {
    const captured = offer;
    if (!captured || disposed) return { kind: 'unavailable' };
    const checked = await api.resource.read({ target, revision: { kind: 'latest' } });
    if (disposed || offer !== captured || !current() || current() !== captured.page || mount !== captured.mount || phase !== captured.phase || checked.kind !== 'available' || !equal(checked.snapshot.ref, captured.readRef)) {
      if (offer === captured) { if (['denied', 'unavailable'].includes(checked.kind)) read = checked; invalidate(); status = 'Preparation changed or access refused; offer withdrawn'; emit(); }
      return { kind: 'stale' };
    }
    const result = controller.actions.adopt(captured.proposalId); offer = null; status = result.kind === 'applied' ? 'Arrangement adopted locally; Pin to save' : `Arrangement ${result.kind}`; emit(); return result;
  }
  const session = { controller, getSnapshot: () => state, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, prepare, observe, refresh, compose, adopt,
    retry: async () => { if (!request || preparing) return { kind: 'unavailable' }; const attempt = {}, epoch = ++nativeEpoch; preparing = attempt; emit(); const result = await admit(request, epoch); if (preparing === attempt) preparing = null; emit(); return result; },
    setWidth: value => { if (Number.isFinite(value) && value >= 40 && value <= 100) { width = value; emit(); } },
    toggleDetail: itemId => { disclosures = disclosures.includes(itemId) ? disclosures.filter(value => value !== itemId) : [...disclosures, itemId]; emit(); },
    reject: () => { invalidate(); status = 'Offer dismissed; current retained'; emit(); },
    cancel: () => { invalidate(); status = 'Composition cancelled; current retained'; emit(); },
    mounted: token => { mount = token; if (token === null) { invalidate(); emit(); } },
    deactivate: () => { mount = null; invalidate(); emit(); },
    async dispose() { disposed = true; invalidate(); unsubscribe(); controller.dispose(); listeners.clear(); },
  };
  emit(); await refresh(); return session;
}
