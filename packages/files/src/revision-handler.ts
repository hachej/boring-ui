import type { ResourceAccess } from './contracts.js';
import type { WorkspaceResourceProvider } from './workspace.js';
import { createResourceHandler } from './remote-handler.js';
import { binding, bindingHeader, bindingValue, catalogHeader, filePage, record, savedRevisions } from './revision-protocol.js';
import { guardStatus, readJsonBody, RequestGuardError } from './request-guard.js';
import { accessSnapshot, identifier } from './publication-input.js';
import { RevisionError } from './revision-contracts.js';
import type { FileListRequest, FileSearchRequest } from './revision-contracts.js';

export interface RevisionHandlerOptions {
  readonly resolve: (request: Request) => Promise<null | {
    readonly provider: WorkspaceResourceProvider;
    readonly access: ResourceAccess;
    readonly release?: () => void | Promise<void>;
  }>;
}
function listRequest(value: unknown): FileListRequest {
  const data = record(value);
  if ((data.directory !== undefined && typeof data.directory !== 'string') || (data.cursor !== undefined && typeof data.cursor !== 'string') || (data.limit !== undefined && typeof data.limit !== 'number')) throw new RevisionError('invalid', 'Invalid listing request');
  return { ...(typeof data.directory === 'string' ? { directory: data.directory } : {}), ...(typeof data.cursor === 'string' ? { cursor: data.cursor } : {}), ...(typeof data.limit === 'number' ? { limit: data.limit } : {}) };
}
export function createRevisionHandler(options: RevisionHandlerOptions): (request: Request) => Promise<Response> {
  return async request => {
    let release: (() => void | Promise<void>) | undefined;
    const operations = new Set<Promise<unknown>>();
    const hold = <T>(pending: Promise<T>): Promise<T> => {
      operations.add(pending);
      void pending.then(() => operations.delete(pending), () => operations.delete(pending));
      return pending;
    };
    const refuse = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
    try {
      if (request.method !== 'GET' && request.method !== 'POST') return refuse(405);
      if (request.signal.aborted) return refuse(403);
      const selected = await options.resolve(request);
      if (!selected) return refuse(403);
      release = selected.release;
      const captured = accessSnapshot(selected.access);
      const access = { ...captured, signal: captured.signal ? AbortSignal.any([captured.signal, request.signal]) : request.signal };
      if (access.signal.aborted) return refuse(403);
      const association = binding({ identity: captured, workspace: selected.provider.identity });
      const respond = (value: unknown) => Response.json(value, { headers: { 'cache-control': 'no-store' } });
      if (request.method === 'GET') return respond(association);
      const header = request.headers.get(bindingHeader);
      if (!header || header.length > 16384) return refuse(403);
      let requested: string;
      try { requested = bindingValue(binding(JSON.parse(decodeURIComponent(header)))); } catch { return refuse(403); }
      if (requested !== bindingValue(association)) return refuse(409);
      const provider = selected.provider;
      if (!request.headers.has(catalogHeader)) return await createResourceHandler({
        authenticate: async () => access,
        reader: { read: (value, context) => hold(provider.read(value, context)) },
        publisher: { publish: (value, context) => hold(provider.publication.publish(value, context)) },
        lookup: { lookup: (value, context) => hold(provider.reconciliation.lookup(value, context)) },
      })(request);
      const input = record(await readJsonBody(request, 32_768, access.signal));
      const requestId = identifier(input.requestId);
      let value: unknown;
      switch (input.kind) {
        case 'list': value = filePage(await provider.catalog.list(listRequest(input.value), access)); break;
        case 'search': {
          const data = record(input.value);
          if (typeof data.query !== 'string') throw new RevisionError('invalid', 'Invalid filename query');
          const query: FileSearchRequest = { ...listRequest(data), query: data.query };
          value = filePage(await provider.catalog.search(query, access)); break;
        }
        case 'history':
          if (typeof input.value !== 'string') throw new RevisionError('invalid', 'Invalid history path');
          value = savedRevisions(await provider.catalog.history(input.value, access)); break;
        default: return refuse(400);
      }
      if (access.signal.aborted) return refuse(403);
      const body = JSON.stringify({ ...association, requestId, kind: input.kind, value });
      if (new TextEncoder().encode(body).byteLength > 8_388_608) return refuse(503);
      return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    } catch (error) {
      return refuse(error instanceof RevisionError ? error.kind === 'invalid' ? 400 : error.kind === 'denied' || error.kind === 'aborted' ? 403 : 503 : error instanceof RequestGuardError || error instanceof TypeError ? guardStatus(error) : 503);
    } finally {
      await Promise.allSettled([...operations]);
      try { await release?.(); } catch { return refuse(503); } finally { if (!request.bodyUsed) void request.body?.cancel().catch(() => {}); }
    }
  };
}
