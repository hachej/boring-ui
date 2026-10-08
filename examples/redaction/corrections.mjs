import { actorSnapshot, decode, equal } from './bindings.mjs';
import { domainPaths, requestId, expectation, expected, readable, correctionRequestTarget, textValue, change, checkedPublication } from './adoption-bindings.mjs';

export function createCorrections({ provider, allowed, getProposal, instanceId }) {
  const access = actor => ({ ...actor, authorizationRef: 'fictional.redaction.correct.v1' });
  const readCorrection = async (subject, itemId, actor, selected) => {
    const target = domainPaths(instanceId, subject, itemId).correction;
    const read = await provider.read({ target, revision: selected?.kind === 'revision'
      ? { kind: 'exact', value: selected.target.revision } : { kind: 'latest' } }, actor);
    if (!readable(read)) throw new Error('Correction is unavailable');
    let value = null;
    if (read.kind === 'available') {
      value = JSON.parse(decode(read.snapshot, 'application/json', 32768));
      if (value.itemId !== itemId || !Number.isSafeInteger(value.basedOnProposal) || value.basedOnProposal < 1
        || Object.keys(value).sort().join(',') !== 'basedOnProposal,itemId,text') throw new TypeError('Invalid correction');
      textValue(value.text);
    }
    return { itemId, expected: expected(read, target), value };
  };
  const viewProposal = async (value, identity) => {
    let ref, actor;
    try { ref = structuredClone(value); actor = actorSnapshot(identity); } catch { return { kind: 'denied' }; }
    const proposal = await getProposal(ref, actor);
    if (proposal.kind !== 'ready') return proposal;
    try {
      const corrections = await Promise.all(Object.values(proposal.catalog).map(id => readCorrection(ref.subject, id, actor)));
      if ([proposal.request.source, proposal.request.config, ref.guard, ref.reservation, ...corrections.map(slot => slot.expected.target)]
        .some(target => !allowed(actor, 'read', target))) return { kind: 'denied' };
      return { kind: 'ready', value: proposal.value, catalog: proposal.catalog, corrections };
    } catch { return { kind: 'unavailable' }; }
  };
  const correctItem = async (value, options, identity) => {
    let ref, actor, input, target;
    try {
      ref = structuredClone(value); actor = actorSnapshot(identity); input = structuredClone(options);
      requestId(input.requestId); textValue(input.text);
      target = domainPaths(instanceId, ref.subject, input.itemId).correction;
      input = { requestId: input.requestId, itemId: input.itemId, expected: expectation(input.expected, target), text: input.text };
    } catch { return { kind: 'denied', reason: 'Invalid correction request' }; }
    if (!allowed(actor, 'correct', target)) return { kind: 'denied', reason: 'Correction denied' };
    const proposal = await getProposal(ref, actor);
    if (proposal.kind !== 'ready') return { kind: proposal.kind === 'denied' ? 'denied' : 'unavailable', reason: 'Proposal unavailable' };
    if (!Object.values(proposal.catalog).includes(input.itemId)) return { kind: 'denied', reason: 'Unknown item' };
    const requestTarget = correctionRequestTarget(instanceId, ref.subject, input.requestId);
    const record = { actor, proposal: ref, ...input };
    const publication = { operationId: JSON.stringify(['fictional.redaction.correct.v1', instanceId, ref.subject, input.requestId]), atomicity: 'all-or-nothing', changes: [
      change({ kind: 'absent', target: requestTarget }, record, 'application/json'),
      change(input.expected, { itemId: input.itemId, text: input.text, basedOnProposal: ref.validation }, 'application/json'),
    ] };
    let retainedRequest = false;
    const retained = async () => {
      const read = await provider.read({ target: requestTarget, revision: { kind: 'latest' } }, actor);
      if (read.kind === 'missing') return null;
      if (read.kind !== 'available') return { kind: 'unavailable', reason: 'Original correction request unavailable' };
      if (!equal(JSON.parse(decode(read.snapshot, 'application/json', 32768)), record)) return { kind: 'conflict', current: [], reason: 'Correction request identity reused' };
      retainedRequest = true;
      const found = await provider.reconciliation.lookup(publication.operationId, access(actor));
      return found.kind === 'not-found' ? { kind: 'unknown', operationId: publication.operationId, reason: 'Correction receipt unavailable' } : checkedPublication(found, publication, actor);
    };
    let dispatched = false;
    try {
      let result = await retained();
      if (!result) {
        if (!allowed(actor, 'correct', target)) return { kind: 'denied', reason: 'Correction denied' };
        dispatched = true;
        result = await checkedPublication(await provider.publication.publish(publication, access(actor)), publication, actor);
        if (result.kind === 'conflict') result = await retained() ?? result;
      }
      return allowed(actor, 'correct', target) && [target, requestTarget, proposal.request.source, proposal.request.config, ref.guard, ref.reservation]
        .every(selected => allowed(actor, 'read', selected))
        ? result : ['committed', 'unknown'].includes(result.kind)
          ? { kind: 'unknown', operationId: publication.operationId, reason: 'Current access does not permit correction evidence' }
          : { kind: 'denied', reason: 'Correction evidence denied' };
    } catch { return dispatched || retainedRequest ? { kind: 'unknown', operationId: publication.operationId, reason: 'Correction acknowledgement unavailable' }
      : { kind: 'unavailable', reason: 'Correction request unavailable' }; }
  };
  return { viewProposal, correctItem, readCorrection };
}
