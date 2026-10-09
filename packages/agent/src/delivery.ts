import { defineExtension, defineTask } from '@earendil-works/pi-durable';
import type { TaskId, TaskOptions, Tx } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';
import type { PublicationLookup, PublicationRequest, PublicationResult, ResourceAccess, ResourceExpectation, ResourcePublisher } from '@hachej/boring-files';
import { parsePublicationResult, publicationDigest } from '@hachej/boring-files/publication';
import { captureDeliveryTarget, identity, migrateDelivery } from './delivery-input.js';
import type { DeliveryInput, DeliveryPhase, DocumentDeliveryTarget } from './delivery-input.js';
export type { DocumentDeliveryTarget } from './delivery-input.js';
export type DocumentDeliveryResult = PublicationResult | { kind: 'invalid'; errors: readonly string[] }
  | { kind: 'producer-failed'; status: string };

export interface DocumentDeliveryOptions {
  readonly operationNamespace: string;
  readonly validationVersion: string;
  readonly publisher: ResourcePublisher;
  readonly lookup: PublicationLookup;
  /** This callback checks real producer output. It does not generate or repair output. */
  readonly validate: (text: string, producer: TaskId<string>, context: Context) => readonly string[];
  readonly resolveAccess: (target: ResourceExpectation, producer: TaskId<string>, context: Context) => ResourceAccess | Promise<ResourceAccess>;
  /** Safe replay requires host qualification of atomic receipts and durable duplicate suppression. */
  readonly replay?: 'safe' | 'reconcile-only';
}

export function createDocumentDelivery(options: DocumentDeliveryOptions) {
  const namespace = options.operationNamespace;
  const validationVersion = options.validationVersion;
  if (!namespace || !validationVersion) throw new TypeError('Stable delivery namespace and validation version are required');
  const operationId = (taskId: TaskId): string => JSON.stringify([namespace, taskId]);
  const task = defineTask<DeliveryInput, DeliveryPhase, DocumentDeliveryResult>({
    name: 'boring.documents.deliver', version: 2, initial: () => ({ phase: 'wait' }), migrate: migrateDelivery,
    phases: {
      wait: async (running, runtime, context) => {
        await runtime.commit(() => ({ status: 'waiting', on: [running.input.producer], policy: 'allSettled', checkpoint: { phase: 'validate' } }), context);
      },
      validate: async (running, runtime, context) => {
        const [outcome] = await runtime.outcomes([running.input.producer], context);
        if (!outcome) throw new Error('Native producer outcome is missing');
        if (outcome.status !== 'completed') {
          await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: { kind: 'producer-failed', status: outcome.status } } }), context);
          return;
        }
        const text = outcome.result;
        const validation: unknown = typeof text !== 'string' ? ['Producer did not return text']
          : new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(text)) !== text ? ['Producer text contains invalid Unicode']
          : options.validate(text, running.input.producer, context);
        const errors = Array.isArray(validation) && validation.every(item => typeof item === 'string')
          ? [...validation] : ['Validator must return an array of errors'];
        await runtime.commit(() => errors.length
          ? { status: 'terminal', outcome: { status: 'completed', result: { kind: 'invalid', errors } } }
          : { status: 'running', checkpoint: { phase: 'publish', text } }, context);
      },
      publish: async (running, runtime, context) => {
        const input = running.input;
        const id = JSON.stringify([input.namespace, runtime.taskId]);
        const unknown = (reason: string): PublicationResult => ({ kind: 'unknown', operationId: id, reason });
        const settle = async (result: DocumentDeliveryResult) => {
          await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result } }), context);
        };
        if (input.namespace !== namespace || input.validationVersion !== validationVersion) {
          await settle(unknown('Delivery binding changed; reconcile using the original binding'));
          return;
        }
        const attempted = await runtime.memo<boolean>('boring.delivery.attempted.v1', context);
        let access: ResourceAccess;
        let activeIdentity;
        try {
          access = { ...await options.resolveAccess(structuredClone(input.target), input.producer, context) };
          activeIdentity = identity(access);
        } catch (error) {
          if (!attempted) throw error;
          await settle(unknown('Access could not be resolved after a publication attempt; reconcile using the original identity'));
          return;
        }
        if (activeIdentity.principalId !== input.identity.principalId || activeIdentity.scopeId !== input.identity.scopeId
          || activeIdentity.initiatorId !== input.identity.initiatorId || activeIdentity.authorizationRef !== input.identity.authorizationRef) {
          await settle(unknown('Delivery identity changed; reconcile using the original authenticated identity'));
          return;
        }
        const request = deliveryRequest(input, id, running.state.checkpoint.text);
        let result: PublicationResult;
        try {
          if (attempted) {
            const found = await options.lookup.lookup(id, { ...access, signal: runtime.signal });
            if (found.kind !== 'not-found') result = parsePublicationResult(found);
            else if (options.replay !== 'safe') result = unknown('No retained receipt; replay has not been qualified');
            else result = parsePublicationResult(await options.publisher.publish(structuredClone(request), { ...access, signal: runtime.signal }));
          } else {
            await runtime.memo('boring.delivery.attempted.v1', true, context);
            result = parsePublicationResult(await options.publisher.publish(structuredClone(request), { ...access, signal: runtime.signal }));
          }
        } catch { result = unknown('Delivery acknowledgement was lost'); }
        result = await deliveryEvidence(input, request, result);
        await settle(result);
      },
    },
    abort: async (running, runtime, context) => {
      const id = JSON.stringify([running.input.namespace, runtime.taskId]);
      // An abort after a publication attempt must not hide a document that may be published.
      let result: PublicationResult | undefined;
      if (await runtime.memo<boolean>('boring.delivery.attempted.v1', context)) {
        try {
          const access = { ...await options.resolveAccess(structuredClone(running.input.target), running.input.producer, context) };
          const input = running.input;
          const activeIdentity = identity(access);
          if (input.namespace !== namespace || input.validationVersion !== validationVersion
            || activeIdentity.principalId !== input.identity.principalId || activeIdentity.scopeId !== input.identity.scopeId
            || activeIdentity.initiatorId !== input.identity.initiatorId || activeIdentity.authorizationRef !== input.identity.authorizationRef) {
            throw new Error('Delivery binding changed');
          }
          const found = await options.lookup.lookup(id, access);
          result = found.kind !== 'not-found' && running.state.checkpoint.phase === 'publish'
            ? await deliveryEvidence(input, deliveryRequest(input, id, running.state.checkpoint.text), parsePublicationResult(found))
            : { kind: 'unknown', operationId: id, reason: 'Aborted after a publication attempt; no matching receipt was retained' };
        } catch { result = { kind: 'unknown', operationId: id, reason: 'Aborted after a publication attempt; the outcome could not be looked up' }; }
      }
      await runtime.commit(() => result ? { status: 'terminal', outcome: { status: 'completed', result } } : { status: 'terminal', outcome: { status: 'aborted' } }, context);
    },
  });

  /** Producer creation and its delivery obligation use one native transaction. */
  async function admit(tx: Tx, createProducer: (tx: Tx) => Promise<TaskId<string>>, target: DocumentDeliveryTarget, taskOptions: TaskOptions, context: Context, access?: ResourceAccess) {
    const captured = captureDeliveryTarget(target);
    const admittedIdentity = access === undefined ? undefined : identity({ ...access });
    const producer = await createProducer(tx);
    const boundIdentity = admittedIdentity ?? identity({ ...await options.resolveAccess(structuredClone(captured.target), producer, context) });
    const delivery = await tx.createTask(task, { producer, ...captured, identity: boundIdentity, namespace, validationVersion }, taskOptions);
    return { producer, delivery, operationId: operationId(delivery) };
  }

  return { task, extension: defineExtension({ name: 'boring.documents.delivery', tasks: [task] }), admit };
}

function deliveryRequest(input: DeliveryInput, id: string, text: string): PublicationRequest {
  const bytes = new TextEncoder().encode(text);
  const request: PublicationRequest = { operationId: id, atomicity: 'all-or-nothing', preconditions: input.preconditions, changes: [input.target.kind === 'absent'
    ? { kind: 'create', target: input.target.target, expected: { kind: 'absent' }, bytes, mediaType: 'text/markdown' }
    : { kind: 'replace', target: input.target.target, bytes, mediaType: 'text/markdown' }] };
  return request;
}

async function deliveryEvidence(input: DeliveryInput, request: PublicationRequest, result: PublicationResult): Promise<PublicationResult> {
  const id = request.operationId;
  const digest = await publicationDigest(request);
  const unknown = (reason: string): PublicationResult => ({ kind: 'unknown', operationId: id, reason });
  if (result.kind === 'committed') {
    const receipt = result.receipt;
    const change = receipt.changes[0];
    const expected = request.changes[0];
    const after = change?.after;
    const targetMatches = after && after.resource.providerId === input.target.target.resource.providerId
      && after.resource.path === input.target.target.resource.path && JSON.stringify(after.view) === JSON.stringify(input.target.target.view);
    const beforeMatches = input.target.kind === 'absent' ? change?.before === null
      : change?.before?.revision === input.target.target.revision && change.before.resource.providerId === input.target.target.resource.providerId
        && change.before.resource.path === input.target.target.resource.path && JSON.stringify(change.before.view) === JSON.stringify(input.target.target.view);
    if (receipt.operationId !== id || receipt.argumentDigest !== digest || receipt.principalId !== input.identity.principalId
      || receipt.scopeId !== input.identity.scopeId || receipt.initiatorId !== input.identity.initiatorId || receipt.changes.length !== 1
      || change?.kind !== expected.kind || !targetMatches || !beforeMatches) result = unknown('Receipt does not match the admitted delivery');
  } else if (result.kind === 'partial' || (result.kind === 'unknown' && result.operationId !== id)) {
    result = unknown('Provider returned incompatible delivery evidence');
  }
  return result;
}
