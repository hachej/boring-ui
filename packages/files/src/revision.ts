import { createResourceClient } from './remote.js';
import { binding, bindingHeader, bindingValue, catalogHeader, changeEvent, filePage, fileTransport, record, savedRevisions, serverEvents } from './revision-protocol.js';
import { readJsonBody } from './request-guard.js';
import { RevisionError } from './revision-contracts.js';
import type { ChangeFeedRequest, RevisionProvider, WorkspaceChangeEvent } from './revision-contracts.js';
import { observe } from './remote-protocol.js';
import { randomUUID } from './platform.js';
import { locator } from './publication-input.js';
export * from './revision-contracts.js';

export async function connectRevisionProvider(options: {
  readonly endpoint: string | URL;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly signal?: AbortSignal;
}): Promise<RevisionProvider> {
  const endpoint = new URL(options.endpoint), fetch = options.fetch;
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) throw new TypeError('Expected an HTTP endpoint without credentials or fragment');
  async function send(request: Request): Promise<unknown> {
    try {
      const pending = fetch(request);
      void pending.then(response => { if (request.signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
      const response = await observe(pending, request.signal);
      if (request.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new RevisionError('aborted', 'File request was cancelled'); }
      if (response.redirected || !response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new RevisionError(response.status === 403 || response.status === 409 ? 'denied' : response.status === 400 ? 'invalid' : 'unavailable', 'The selected workspace is unavailable or no longer authorized');
      }
      return await readJsonBody(response, 8_388_608, request.signal);
    } catch (error) {
      if (request.signal.aborted) throw new RevisionError('aborted', 'File request was cancelled');
      if (error instanceof RevisionError) throw error;
      throw new RevisionError('unavailable', 'The file request could not be completed');
    }
  }
  const discovered = record(await send(new Request(endpoint, { method: 'GET', redirect: 'error', ...(options.signal ? { signal: options.signal } : {}) })));
  const selected = binding(discovered), bound = bindingValue(selected);
  // The host's file size limit (`createRevisionHandler({ maxFileBytes })`); a host that names none keeps the transport's defaults.
  const maxFileBytes = discovered.limits === undefined ? undefined : record(discovered.limits).maxFileBytes;
  let transport: ReturnType<typeof fileTransport> | undefined;
  if (maxFileBytes !== undefined) {
    try { transport = fileTransport(maxFileBytes as number); } catch { throw new RevisionError('invalid', 'Invalid file size limit'); }
  }
  const client = createResourceClient({ endpoint, identity: selected.identity, publication: true, reconciliation: true, ...transport,
    fetch: request => { const headers = new Headers(request.headers); headers.set(bindingHeader, bound); return fetch(new Request(request, { headers })); } });
  async function invoke(kind: string, value: unknown, signal?: AbortSignal): Promise<unknown> {
    const requestId = randomUUID();
    const result = record(await send(new Request(endpoint, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', [bindingHeader]: bound, [catalogHeader]: '1' }, body: JSON.stringify({ requestId, kind, value }), ...(signal ? { signal } : {}) })));
    if (bindingValue(binding(result)) !== bound || result.kind !== kind || result.requestId !== requestId) throw new RevisionError('denied', 'The response belongs to another workspace');
    return result.value;
  }
  /** One feed across reconnections: each resumes after the last seq delivered; a refused binding ends it. */
  async function* changes(request: ChangeFeedRequest = {}): AsyncGenerator<WorkspaceChangeEvent> {
    const signal = request.signal;
    let cursor = request.since, incarnation = request.incarnation, staged: string | undefined, delay = 500;
    const pause = () => new Promise<void>(resolve => {
      const timer = setTimeout(done, delay);
      function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
      signal?.addEventListener('abort', done, { once: true });
      delay = Math.min(delay * 2, 30_000);
    });
    while (!signal?.aborted) {
      const url = new URL(endpoint);
      url.searchParams.set('op', 'changes');
      if (cursor !== undefined) { url.searchParams.set('since', String(cursor)); if (incarnation !== undefined) url.searchParams.set('incarnation', incarnation); }
      const connection = new AbortController();
      const stop = () => connection.abort();
      signal?.addEventListener('abort', stop, { once: true });
      try {
        let response: Response;
        try { response = await fetch(new Request(url, { method: 'GET', redirect: 'error', headers: { accept: 'text/event-stream', [bindingHeader]: bound }, signal: connection.signal })); }
        catch { if (signal?.aborted) return; await pause(); continue; }
        if (response.redirected || !response.ok || !response.body) {
          void response.body?.cancel().catch(() => {});
          if (response.status === 403 || response.status === 409) throw new RevisionError('denied', 'The selected workspace is unavailable or no longer authorized');
          // 501: the route serves no change feed (the intended signal); 400 is the same ending, kept for hosts that already answer it.
          if (response.status === 400 || response.status === 501) throw new RevisionError('invalid', response.status === 501 ? 'The route serves no change feed' : 'The change feed request was refused');
          await pause(); continue;
        }
        try {
          for await (const message of serverEvents(response.body)) {
            if (message.event === 'ready') {
              const ready = record(JSON.parse(message.data)), seq = ready.seq;
              // A new provider lifetime is adopted with its resnapshot, not with `ready`: a disconnect in between must reconnect with the
              // old cursor and incarnation, which the server answers with a resnapshot again.
              if (typeof ready.incarnation === 'string') { if (cursor === undefined || incarnation === undefined) incarnation = ready.incarnation; else staged = ready.incarnation; }
              if (cursor === undefined && typeof seq === 'number' && Number.isSafeInteger(seq)) cursor = seq;
              delay = 500;
              continue;
            }
            if (message.event !== 'change' && message.event !== 'resnapshot') continue;
            const event = changeEvent(JSON.parse(message.data));
            if (event.kind === 'change' && cursor !== undefined && event.seq <= cursor) continue;
            if (event.kind === 'resnapshot' && staged !== undefined) { incarnation = staged; staged = undefined; }
            cursor = event.seq;
            yield event;
          }
        } catch (error) { if (signal?.aborted) return; if (error instanceof RevisionError && error.kind === 'invalid') throw error; }
      } finally {
        signal?.removeEventListener('abort', stop);
        connection.abort();
      }
      if (signal?.aborted) return;
      await pause();
    }
  }
  if (!client.publish || !client.lookup) throw new Error('Publishing client lacks reconciliation');
  return {
    ...client, publish: client.publish, lookup: client.lookup, ...(transport ? { maxFileBytes: maxFileBytes as number } : {}),
    identity: Object.freeze(selected.identity), workspace: Object.freeze(selected.workspace),
    locate: path => locator({ resource: { providerId: selected.workspace.providerId, path }, view: { kind: 'published' } }),
    list: async (request, signal) => filePage(await invoke('list', request, signal)),
    search: async (request, signal) => filePage(await invoke('search', request, signal)),
    history: async (path, signal) => savedRevisions(await invoke('history', path, signal)),
    changes: request => changes(request),
  };
}
