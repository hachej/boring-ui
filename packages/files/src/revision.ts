import { createResourceClient } from './remote.js';
import { binding, bindingHeader, bindingValue, catalogHeader, filePage, record, savedRevisions } from './revision-protocol.js';
import { readJsonBody } from './request-guard.js';
import { RevisionError } from './revision-contracts.js';
import type { RevisionProvider } from './revision-contracts.js';
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
  const selected = binding(await send(new Request(endpoint, { method: 'GET', redirect: 'error', ...(options.signal ? { signal: options.signal } : {}) })));
  const bound = bindingValue(selected);
  const client = createResourceClient({ endpoint, identity: selected.identity, publication: true, reconciliation: true,
    fetch: request => { const headers = new Headers(request.headers); headers.set(bindingHeader, bound); return fetch(new Request(request, { headers })); } });
  async function invoke(kind: string, value: unknown, signal?: AbortSignal): Promise<unknown> {
    const requestId = randomUUID();
    const result = record(await send(new Request(endpoint, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', [bindingHeader]: bound, [catalogHeader]: '1' }, body: JSON.stringify({ requestId, kind, value }), ...(signal ? { signal } : {}) })));
    if (bindingValue(binding(result)) !== bound || result.kind !== kind || result.requestId !== requestId) throw new RevisionError('denied', 'The response belongs to another workspace');
    return result.value;
  }
  if (!client.publish || !client.lookup) throw new Error('Publishing client lacks reconciliation');
  return {
    ...client, publish: client.publish, lookup: client.lookup, identity: Object.freeze(selected.identity), workspace: Object.freeze(selected.workspace),
    locate: path => locator({ resource: { providerId: selected.workspace.providerId, path }, view: { kind: 'published' } }),
    list: async (request, signal) => filePage(await invoke('list', request, signal)),
    search: async (request, signal) => filePage(await invoke('search', request, signal)),
    history: async (path, signal) => savedRevisions(await invoke('history', path, signal)),
  };
}
