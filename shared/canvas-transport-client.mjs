import { readJsonBody } from '@hachej/boring-files/request-guard';
import { schema, version, maxBodyBytes, maxResultBytes, parseTarget, sameTarget, parseOpened, parseEnvelope, parseResult, json } from './canvas-transport-protocol.mjs';

/** One mounted viewer and one connection. Closing this transport never disposes the borrowed viewer. */
export async function connectCanvasPresentation({ endpoint, fetch: send = globalThis.fetch, tools, signal }) {
  const target = parseTarget(tools.getTarget());
  const cancellation = new AbortController();
  const active = signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal;
  active.throwIfAborted();
  const address = (operation, id) => {
    const url = new URL(endpoint);
    url.searchParams.set('op', operation);
    if (id) url.searchParams.set('connectionId', id);
    return url;
  };
  let id;
  const seen = new Set();
  const interruptible = async promise => {
    if (active.aborted) { Promise.resolve(promise).catch(() => {}); active.throwIfAborted(); }
    let abort;
    const interrupted = new Promise((_, reject) => { abort = () => reject(active.reason); active.addEventListener('abort', abort, { once: true }); });
    try { return await Promise.race([promise, interrupted]); }
    finally { active.removeEventListener('abort', abort); }
  };
  const post = (operation, value, requestSignal = active) => send(new Request(address(operation, id), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: json(value, operation === 'result' ? maxResultBytes : maxBodyBytes), signal: requestSignal,
  }));
  const disconnect = async () => {
    if (!id) return;
    const closing = Promise.resolve().then(() => send(new Request(address('close', id), { method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(1000) }))).then(() => undefined, () => undefined);
    let timer;
    await Promise.race([closing, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]);
    clearTimeout(timer);
  };
  try {
    const response = await interruptible(post('open', { schema, version, target }));
    if (response.status !== 200) throw new Error(`Canvas presentation connection refused: ${response.status}`);
    const opened = parseOpened(await readJsonBody(response, maxBodyBytes, active));
    id = opened.connectionId;
    if (!sameTarget(opened.target, target)) throw new Error('Canvas presentation target changed during connection');
    active.throwIfAborted();
  } catch (error) {
    cancellation.abort();
    await disconnect();
    throw error;
  }
  const closed = (async () => {
    try {
      while (!active.aborted) {
        const response = await interruptible(send(new Request(address('poll', id), { signal: active })));
        if (response.status === 204) continue;
        if (response.status !== 200) throw new Error(`Canvas presentation poll ended: ${response.status}`);
        const envelope = parseEnvelope(await readJsonBody(response, maxBodyBytes, active));
        if (envelope.connectionId !== id || !sameTarget(envelope.target, target)) throw new Error('Canvas presentation envelope binding changed');
        if (seen.has(envelope.requestId) || seen.size === 256) throw new Error('Canvas presentation request was already delivered or connection capacity ended');
        seen.add(envelope.requestId);
        active.throwIfAborted();
        const result = parseResult(envelope.command, await interruptible(tools[envelope.command].invoke(envelope.target, envelope.input, active)), target);
        active.throwIfAborted();
        json(result, maxResultBytes);
        const acknowledgement = await interruptible(post('result', { schema, version, connectionId: id, requestId: envelope.requestId, result }));
        if (acknowledgement.status !== 204) throw new Error(`Canvas presentation result was not accepted: ${acknowledgement.status}`);
      }
    } catch {
      cancellation.abort();
    } finally {
      cancellation.abort();
      await disconnect();
    }
  })();
  return { id, target: structuredClone(target), closed, close: async () => { cancellation.abort(); await closed; } };
}
