import type { ResourceClient } from './client.js';
import type { PublicationLookupResult, PublicationResult, ReadResult } from './contracts.js';
import { PublicationNotDispatchedError, identifier, publicationDigest, publicationSnapshot } from './publication-input.js';
import { contentType, encode, envelope, identity, jsonBody, limit, lookupResult, observe, publicationResult, readResult, readSnapshot, sameIdentity, schema, version } from './remote-protocol.js';
import type { ResourceCall, ResourceIdentity } from './remote-protocol.js';
import { randomUUID } from './platform.js';
export { createResourceHandler } from './remote-handler.js';
export type { ResourceHandlerOptions } from './remote-handler.js';
export type { ResourceIdentity } from './remote-protocol.js';

interface ResourceClientBase {
  readonly identity: ResourceIdentity;
  readonly endpoint: string | URL;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
}
/**
 * A client that can publish must also be able to reconcile (`lookup`): after one lost acknowledgement the editor's save
 * is `unknown`, and without a lookup nothing can release it, so the editor would stay unsavable until a reload dropped
 * the unsaved text. The type requires both, and the constructor throws if a plain-JS caller sets only `publication`.
 */
export type ResourceClientOptions = ResourceClientBase & (
  | { readonly publication: true; readonly reconciliation: true }
  | { readonly publication?: false; readonly reconciliation?: boolean });

export function createResourceClient(options: ResourceClientOptions): ResourceClient {
  if (options.publication && !options.reconciliation) throw new TypeError('A publishing resource client needs reconciliation: a lost save acknowledgement could otherwise never be resolved');
  const selected = identity(options.identity), endpoint = new URL(options.endpoint);
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) throw new TypeError('Expected an HTTP endpoint without credentials or fragment');
  const fetch = options.fetch;
  const requestLimit = limit(options.maxRequestBytes ?? 4_194_304), responseLimit = limit(options.maxResponseBytes ?? 8_388_608);
  async function invoke(call: ResourceCall, signal?: AbortSignal): Promise<unknown> {
    let dispatched = false;
    const abort = new AbortController();
    const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    try {
      if (combined.aborted) throw new Error('Resource observation aborted');
      const requestId = randomUUID();
      const body = encode({ schema, version, requestId, identity: selected, ...call }, requestLimit);
      const request = new Request(endpoint, { method: 'POST', headers: { 'content-type': contentType }, body, redirect: 'error', signal: combined });
      if (combined.aborted) throw new Error('Resource observation aborted');
      dispatched = true;
      const pending = fetch(request);
      void pending.then(response => { if (combined.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
      const response = await observe(pending, combined);
      if (response.redirected || response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        throw new Error('Remote resource response unavailable');
      }
      const result = envelope(await jsonBody(response, responseLimit, combined));
      if (result.requestId !== requestId || result.kind !== call.kind || !sameIdentity(result.identity, selected)) throw new TypeError('Resource response association mismatch');
      return result.value;
    } catch {
      if (call.kind === 'publish' && !dispatched) throw new PublicationNotDispatchedError(call.value.operationId);
      throw new Error('Remote resource operation is unconfirmed');
    } finally { abort.abort(); }
  }
  return {
    read: async (request, signal): Promise<ReadResult> => {
      const captured = readSnapshot(request);
      try { return readResult(await invoke({ kind: 'read', value: captured }, signal), captured, true); }
      catch { return { kind: 'unavailable', reason: 'Remote resource read is unconfirmed' }; }
    },
    ...(options.publication ? {
      publish: async (request, signal): Promise<PublicationResult> => {
        const captured = publicationSnapshot(request);
        let digest: string;
        try {
          if (captured.atomicity !== 'all-or-nothing') throw new TypeError('Remote per-change publication is not qualified');
          digest = await publicationDigest(captured);
        } catch { throw new PublicationNotDispatchedError(captured.operationId); }
        try {
          return publicationResult(await invoke({ kind: 'publish', value: captured }, signal), captured.operationId, selected, captured, digest);
        } catch (error) {
          if (error instanceof PublicationNotDispatchedError) throw error;
          return { kind: 'unknown', operationId: captured.operationId, reason: 'Remote publication is unconfirmed; reconcile the original operation without automatic replay' };
        }
      },
    } satisfies Pick<ResourceClient, 'publish'> : {}),
    ...(options.reconciliation ? {
      lookup: async (operationId, signal): Promise<PublicationLookupResult> => {
        const captured = identifier(operationId);
        try { return lookupResult(await invoke({ kind: 'lookup', value: captured }, signal), captured, selected); }
        catch { return { kind: 'unknown', operationId: captured, reason: 'Remote operation lookup is unconfirmed' }; }
      },
    } satisfies Pick<ResourceClient, 'lookup'> : {}),
  };
}
