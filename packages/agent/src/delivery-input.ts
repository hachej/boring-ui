import type { TaskId } from '@earendil-works/pi-durable';
import type { ResourceAccess, ResourceExpectation } from '@hachej/boring-files';
import { locator, reference } from '@hachej/boring-files/publication';

type Identity = Pick<ResourceAccess, 'principalId' | 'scopeId' | 'initiatorId'> & { authorizationRef: string | null };
export type DocumentDeliveryTarget = ResourceExpectation & { readonly preconditions?: readonly ResourceExpectation[] };
export type DeliveryInput = {
  producer: TaskId<string>; target: ResourceExpectation; preconditions: readonly ResourceExpectation[];
  identity: Identity; namespace: string; validationVersion: string;
};
export type DeliveryPhase = { phase: 'wait' } | { phase: 'validate' } | { phase: 'publish'; text: string };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid delivery binding');
  return Object.fromEntries(Object.entries(value));
}

function expectation(value: unknown): ResourceExpectation {
  const input = object(value);
  if (input.kind === 'absent') return { kind: 'absent', target: locator(input.target) };
  if (input.kind === 'revision') return { kind: 'revision', target: reference(input.target) };
  throw new TypeError('Invalid delivery expectation');
}

export function captureDeliveryTarget(value: DocumentDeliveryTarget) {
  const input = object(value);
  if (input.preconditions !== undefined && !Array.isArray(input.preconditions)) throw new TypeError('Invalid delivery preconditions');
  return { target: expectation(input), preconditions: input.preconditions === undefined ? [] : Array.from(input.preconditions, expectation) };
}

export function identity(access: ResourceAccess): Identity {
  const result = { principalId: access.principalId, scopeId: access.scopeId, initiatorId: access.initiatorId, authorizationRef: access.authorizationRef ?? null };
  if ([result.principalId, result.scopeId, result.initiatorId].some(value => typeof value !== 'string' || !value)) throw new TypeError('Delivery requires an authenticated identity');
  return result;
}

function nonempty(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new TypeError('Invalid v1 delivery binding');
  return value;
}

function producerId(value: unknown): value is TaskId<string> {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function migrateDelivery(input: unknown, checkpoint: unknown, fromVersion: number): { input: DeliveryInput; checkpoint: DeliveryPhase } {
  if (fromVersion !== 1) throw new TypeError('Unsupported delivery version');
  const old = object(input), phase = object(checkpoint), actor = object(old.identity);
  if (!producerId(old.producer) || 'preconditions' in old) throw new TypeError('Invalid v1 delivery input');
  if (actor.authorizationRef !== null && typeof actor.authorizationRef !== 'string') throw new TypeError('Invalid v1 delivery identity');
  const migrated: DeliveryInput = {
    producer: old.producer, target: expectation(old.target), preconditions: [],
    identity: {
      principalId: nonempty(actor.principalId), scopeId: nonempty(actor.scopeId), initiatorId: nonempty(actor.initiatorId),
      authorizationRef: actor.authorizationRef,
    },
    namespace: nonempty(old.namespace), validationVersion: nonempty(old.validationVersion),
  };
  if (phase.phase === 'wait' || phase.phase === 'validate') return { input: migrated, checkpoint: { phase: phase.phase } };
  if (phase.phase === 'publish' && typeof phase.text === 'string') return { input: migrated, checkpoint: { phase: 'publish', text: phase.text } };
  throw new TypeError('Invalid v1 delivery checkpoint');
}
