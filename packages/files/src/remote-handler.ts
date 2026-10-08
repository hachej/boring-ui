import type { PublicationLookup, ResourceAccess, ResourcePublisher, ResourceReader } from './contracts.js';
import { guardStatus, readJsonBody } from './request-guard.js';
import { accessSnapshot, publicationDigest } from './publication-input.js';
import { contentType, decodeCall, encode, envelope, identity, limit, lookupResult, observe, publicationResult, readResult, sameIdentity, schema, version } from './remote-protocol.js';

export interface ResourceHandlerOptions {
  readonly authenticate: (request: Request) => Promise<ResourceAccess | null>;
  readonly reader: ResourceReader;
  readonly publisher?: ResourcePublisher;
  readonly lookup?: PublicationLookup;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
}

export function createResourceHandler(options: ResourceHandlerOptions): (request: Request) => Promise<Response> {
  const { authenticate, reader, publisher, lookup } = options;
  const requestLimit = limit(options.maxRequestBytes ?? 4_194_304), responseLimit = limit(options.maxResponseBytes ?? 8_388_608);
  return async request => {
    const refuse = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
    try {
      if (request.method !== 'POST') return refuse(405);
      const authenticated = await observe(authenticate(request), request.signal);
      if (!authenticated) return refuse(403);
      const captured = accessSnapshot(authenticated);
      const signal = captured.signal ? AbortSignal.any([captured.signal, request.signal]) : request.signal;
      const access: ResourceAccess = { ...captured, signal };
      if (signal.aborted) return refuse(403);
      const input = envelope(await readJsonBody(request, requestLimit, signal));
      if (!sameIdentity(input.identity, captured)) return refuse(403);
      const call = decodeCall(input);
      let value: unknown;
      switch (call.kind) {
        case 'read': {
          if (signal.aborted) return refuse(403);
          value = readResult(await observe(reader.read(call.value, access), signal), call.value);
          break;
        }
        case 'publish': {
          if (!publisher) return refuse(405);
          const digest = await observe(publicationDigest(call.value), signal);
          if (signal.aborted) return refuse(403);
          value = publicationResult(await observe(publisher.publish(call.value, access), signal), call.value.operationId, captured, call.value, digest);
          break;
        }
        case 'lookup': {
          if (!lookup) return refuse(405);
          if (signal.aborted) return refuse(403);
          value = lookupResult(await observe(lookup.lookup(call.value, access), signal), call.value, captured);
          break;
        }
      }
      if (signal.aborted) return refuse(403);
      const body = encode({ schema, version, requestId: input.requestId, identity: identity(captured), kind: call.kind, value }, responseLimit);
      return new Response(body, { status: 200, headers: { 'content-type': contentType, 'cache-control': 'no-store' } });
    } catch (error) { return refuse(guardStatus(error)); }
    finally { if (!request.bodyUsed) void request.body?.cancel().catch(() => {}); }
  };
}
