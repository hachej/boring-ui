import type { ResourceAccess } from './contracts.js';
import type { WorkspaceResourceProvider } from './workspace.js';
import { createResourceHandler } from './remote-handler.js';
import { binding, bindingHeader, bindingValue, catalogHeader, filePage, record, savedRevisions } from './revision-protocol.js';
import { guardStatus, readJsonBody, RequestGuardError } from './request-guard.js';
import { accessSnapshot, identifier } from './publication-input.js';
import { RevisionError } from './revision-contracts.js';
import type { FileListRequest, FileSearchRequest } from './revision-contracts.js';

export interface RevisionHandlerOptions {
  /** The host's authentication and workspace selection, once per request. For the change feed the lease is held until the stream ends. */
  readonly resolve: (request: Request) => Promise<null | {
    readonly provider: WorkspaceResourceProvider;
    readonly access: ResourceAccess;
    readonly release?: () => void | Promise<void>;
  }>;
  /** How often the change feed sends a comment line so proxies keep it open, in milliseconds (default 15 000). */
  readonly heartbeatMs?: number;
}

const encoder = new TextEncoder();

/**
 * `GET ?op=changes[&since=<seq>]`: the workspace's change feed as server-sent events (`event: change | resnapshot`, `id:` the seq,
 * `data:` the JSON event), after an `event: ready` naming the current seq, with a comment every `heartbeatMs`. Plain streamed
 * responses, so it runs on Node and on Workers alike. The stream ends when the person disconnects or their access is revoked; the
 * workspace lease is released then.
 */
function changeStream(provider: WorkspaceResourceProvider, access: ResourceAccess & { readonly signal: AbortSignal }, since: number | undefined, heartbeatMs: number, release: () => Promise<void>): Response {
  const stop = new AbortController();
  const signal = AbortSignal.any([access.signal, stop.signal]);
  let timer: ReturnType<typeof setInterval> | undefined;
  const finish = () => { stop.abort(); clearInterval(timer); };
  const body = new ReadableStream<Uint8Array>({
    start: controller => {
      const send = (text: string) => { if (!signal.aborted) try { controller.enqueue(encoder.encode(text)); } catch { finish(); } };
      timer = setInterval(() => send(': heartbeat\n\n'), heartbeatMs);
      void (async () => {
        try {
          // Without a cursor the feed starts at the current seq, which the client learns first and resumes from after a disconnect.
          const start = since ?? provider.changeHead();
          send(`event: ready\ndata: ${JSON.stringify({ seq: start })}\n\n`);
          for await (const event of provider.changes({ since: start, signal }, { ...access, signal })) {
            if (signal.aborted) break;
            send(`id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
          }
        } catch { /* the stream ends; the client reconnects from its last seq */ }
        finally {
          finish();
          try { controller.close(); } catch { /* already cancelled */ }
          await release();
        }
      })();
    },
    cancel: () => { finish(); },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
function listRequest(value: unknown): FileListRequest {
  const data = record(value);
  if ((data.directory !== undefined && typeof data.directory !== 'string') || (data.cursor !== undefined && typeof data.cursor !== 'string') || (data.limit !== undefined && typeof data.limit !== 'number')) throw new RevisionError('invalid', 'Invalid listing request');
  return { ...(typeof data.directory === 'string' ? { directory: data.directory } : {}), ...(typeof data.cursor === 'string' ? { cursor: data.cursor } : {}), ...(typeof data.limit === 'number' ? { limit: data.limit } : {}) };
}
export function createRevisionHandler(options: RevisionHandlerOptions): (request: Request) => Promise<Response> {
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 1) throw new RangeError('The heartbeat interval must be a positive integer');
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
      const op = new URL(request.url).searchParams.get('op');
      if (request.method === 'GET' && op === null) return respond(association);
      const header = request.headers.get(bindingHeader);
      if (!header || header.length > 16384) return refuse(403);
      let requested: string;
      try { requested = bindingValue(binding(JSON.parse(decodeURIComponent(header)))); } catch { return refuse(403); }
      if (requested !== bindingValue(association)) return refuse(409);
      const provider = selected.provider;
      if (request.method === 'GET') {
        if (op !== 'changes') return refuse(400);
        const cursor = new URL(request.url).searchParams.get('since');
        if (cursor !== null && !/^\d{1,16}$/.test(cursor)) return refuse(400);
        const since = cursor === null ? undefined : Number(cursor);
        if (since !== undefined && !Number.isSafeInteger(since)) return refuse(400);
        // The stream owns the lease from here: it is released when the stream ends, not when this function returns.
        const lease = release;
        release = undefined;
        return changeStream(provider, access, since, heartbeatMs, async () => { try { await lease?.(); } catch { /* the stream already ended */ } });
      }
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
