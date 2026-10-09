import { randomUUID } from 'node:crypto';
import { parsePublicationResult, publicationDigest } from '@hachej/boring-files/publication';
import { actorSnapshot, decode, equal, requestSnapshot, reservationOperation, reservationPublication, reservationTarget } from './bindings.mjs';

export function createReservations({ provider, publish }) {
  const retained = async (request, actor) => {
    const read = await provider.read({ target: reservationTarget(request), revision: { kind: 'latest' } }, actor);
    if (read.kind !== 'available') return { kind: read.kind === 'missing' ? 'missing' : 'unavailable' };
    let record;
    try {
      record = JSON.parse(decode(read.snapshot, 'application/json', 16384));
      const canonical = { format: 'fictional.redaction.request', version: 1,
        generationId: record.generationId, actor: actorSnapshot(record.actor), request: requestSnapshot(record.request, request.instanceId) };
      if (typeof record.generationId !== 'string' || !/^[0-9a-f-]{36}$/.test(record.generationId) || !equal(record, canonical)) return { kind: 'unavailable' };
      if (!equal(record.actor, actor) || !equal(record.request, request)) return { kind: 'conflict' };
    } catch { return { kind: 'unavailable' }; }
    const found = await provider.reconciliation.lookup(reservationOperation(request), actor);
    if (found.kind !== 'committed') return { kind: 'unavailable' };
    const receipt = parsePublicationResult(found).receipt, publication = reservationPublication(record);
    const [reservation, guard] = receipt.changes;
    const before = request.generation.kind === 'absent' ? null : request.generation.target;
    if (receipt.operationId !== publication.operationId || receipt.argumentDigest !== await publicationDigest(publication)
      || receipt.principalId !== actor.principalId || receipt.initiatorId !== actor.initiatorId || receipt.scopeId !== actor.scopeId
      || receipt.changes.length !== 2 || reservation?.kind !== 'create' || reservation.before !== null
      || !equal(reservation.after, read.snapshot.ref) || guard?.kind !== publication.changes[1].kind
      || !equal(guard.before, before) || !guard.after
      || !equal({ resource: guard.after.resource, view: guard.after.view }, { resource: request.generation.target.resource, view: request.generation.target.view })) return { kind: 'unavailable' };
    return { kind: 'ready', record, reservation: reservation.after, guard: guard.after };
  };

  const reserve = async (request, actor) => {
    let prior;
    try { prior = await retained(request, actor); } catch { return { kind: 'unavailable' }; }
    if (prior.kind !== 'missing') return prior;
    const record = { format: 'fictional.redaction.request', version: 1, generationId: randomUUID(), actor, request };
    const result = await publish(reservationPublication(record), actor);
    if (result.kind === 'committed' || result.kind === 'conflict') {
      const stored = await retained(request, actor);
      if (result.kind === 'committed' && stored.kind !== 'ready') return { kind: 'reserved' };
      return stored.kind === 'missing' ? { kind: result.kind === 'conflict' ? 'conflict' : 'unavailable' } : stored;
    }
    return { kind: ['denied', 'unavailable'].includes(result.kind) ? result.kind : 'unknown' };
  };
  return { reserve };
}
