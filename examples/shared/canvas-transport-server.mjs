import { readJsonBody, guardStatus } from '@hachej/boring-files/request-guard';
import { schema, version, maxBodyBytes, maxResultBytes, parseIdentity, parseOpen, parseConnection, parseInput, parseReply, parseResult, sameIdentity, sameTarget, inputSchema, json } from './canvas-transport-protocol.mjs';

const response = (status, value) => new Response(value === undefined ? null : json(value), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
});
const refusal = (kind, reason) => ({ kind, reason });

export function createCanvasTransport({ authenticate, authorize, timeoutMs = 5000, maxConnections = 32 }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 || !Number.isSafeInteger(maxConnections) || maxConnections < 1 || maxConnections > 1024) throw new TypeError('Invalid canvas transport limits');
  const connections = new Map();
  let closed = false;
  async function allowed(identity, target, phase, command) {
    try { return await authorize({ identity: structuredClone(identity), target: structuredClone(target), phase, command }) === true; }
    catch { return false; }
  }
  function attach(identity, target, revoked) {
    const id = globalThis.crypto.randomUUID();
    let alive = true, poll, pending, idle;
    function touch() { clearTimeout(idle); idle = setTimeout(close, timeoutMs * 2); }
    function finish(result) {
      const current = pending;
      if (!current) return;
      pending = undefined;
      clearTimeout(current.timer);
      current.signal?.removeEventListener('abort', current.abort);
      current.cleanup?.();
      current.resolve(result);
      if (alive) touch();
    }
    function close() {
      if (!alive) return;
      alive = false;
      connections.delete(id);
      clearTimeout(idle);
      revoked.removeEventListener('abort', close);
      finish(pending?.delivered ? refusal('unknown', 'Presentation acknowledgement was lost; the command may have applied and was not replayed') : refusal('unavailable', 'Presentation connection closed before delivery'));
      poll?.finish(response(410));
    }
    async function deliver() {
      const current = pending, receiver = poll;
      if (!current || !current.admitted || current.delivering || !receiver || current.delivered) return;
      current.delivering = true;
      const permitted = await allowed(identity, target, 'delivery', current.command);
      if (!alive || pending !== current) return;
      if (poll !== receiver) { current.delivering = false; void deliver(); return; }
      if (!permitted || revoked.aborted || receiver.revoked.aborted || receiver.signal.aborted || Date.now() >= current.expiresAt) { close(); return; }
      current.delivered = true;
      current.cleanup = receiver.cleanup;
      receiver.finish(response(200, current.envelope), false);
    }
    const command = name => ({ name: name === 'select' ? 'select_mounted_canvas' : 'propose_mounted_canvas_edits', input: inputSchema(name),
      invoke: async (selected, input, signal) => {
        let parsed;
        try {
          if (!sameTarget(selected, target)) return refusal('stale', 'Presentation target changed');
          parsed = parseInput(name, input);
          json(parsed);
        } catch { return refusal('denied', 'Invalid presentation input'); }
        if (parsed.expiresAt <= Date.now()) return refusal('stale', 'Presentation command expired');
        if (!alive || revoked.aborted || signal?.aborted || !poll) return refusal('unavailable', 'No live presentation receiver');
        if (pending) return refusal('unavailable', 'Presentation connection is busy');
        parsed.expiresAt = Math.min(parsed.expiresAt, Date.now() + timeoutMs);
        const envelope = { schema, version, connectionId: id, requestId: globalThis.crypto.randomUUID(), command: name, target, input: parsed };
        try { json(envelope); } catch { return refusal('denied', 'Presentation payload exceeds its byte limit'); }
        return new Promise(resolve => {
          const current = { command: name, envelope, expiresAt: Math.min(parsed.expiresAt, Date.now() + timeoutMs), signal, resolve, delivered: false, delivering: false, admitted: false, abort: () => close() };
          pending = current;
          current.timer = setTimeout(close, Math.max(0, current.expiresAt - Date.now()));
          signal?.addEventListener('abort', current.abort, { once: true });
          void allowed(identity, target, 'invoke', name).then(permitted => {
            if (!alive || pending !== current) return;
            if (!permitted || revoked.aborted || signal?.aborted || Date.now() >= current.expiresAt) { finish(refusal('denied', 'Presentation admission denied')); return; }
            current.admitted = true;
            void deliver();
          });
        });
      },
    });
    const connection = {
      id, get identity() { return structuredClone(identity); }, get target() { return structuredClone(target); }, select: command('select'), propose: command('propose'), close,
      poll(request, access) {
        if (!alive) return response(410);
        if (poll || pending?.delivered) return response(409);
        touch();
        return new Promise(resolve => {
          const abort = () => close();
          const receiver = { signal: request.signal, revoked: access.revoked,
            cleanup() { clearTimeout(receiver.timer); request.signal.removeEventListener('abort', abort); access.revoked.removeEventListener('abort', abort); },
            finish(value, cleanup = true) { if (poll === receiver) poll = undefined; if (cleanup) receiver.cleanup(); else clearTimeout(receiver.timer); resolve(value); },
          };
          poll = receiver;
          receiver.timer = setTimeout(() => receiver.finish(response(204)), timeoutMs);
          request.signal.addEventListener('abort', abort, { once: true });
          access.revoked.addEventListener('abort', abort, { once: true });
          if (request.signal.aborted || access.revoked.aborted) close();
          else void deliver();
        });
      },
      async result(reply, access, request) {
        const current = pending;
        if (!current?.delivered || current.envelope.requestId !== reply.requestId) return response(409);
        let result;
        try { result = parseResult(current.command, reply.result, target); json(result, maxResultBytes); }
        catch { return response(400); }
        const permitted = await allowed(identity, target, 'result', current.command);
        if (!alive || pending !== current) return response(409);
        if (!permitted || revoked.aborted || access.revoked.aborted || request.signal.aborted) { close(); return response(403); }
        if (Date.now() >= current.expiresAt) { close(); return response(409); }
        finish(result);
        return response(204);
      },
    };
    connections.set(id, connection);
    revoked.addEventListener('abort', close, { once: true });
    touch();
    if (revoked.aborted) close();
    return connection;
  }
  async function handle(request) {
    const url = new URL(request.url), op = url.searchParams.get('op');
    if (!['open', 'poll', 'result', 'close'].includes(op) || request.method !== (op === 'poll' ? 'GET' : 'POST')) return response(405);
    let access;
    try {
      const authenticated = await authenticate(request);
      if (!authenticated) return response(401);
      access = { identity: parseIdentity(authenticated.identity), revoked: authenticated.revoked };
      if (!(access.revoked instanceof AbortSignal)) return response(503);
    } catch { return response(503); }
    if (access.revoked.aborted || request.signal.aborted) return response(403);
    if (closed) return response(410);
    let body, id;
    try {
      if (op === 'open') body = parseOpen(await readJsonBody(request, maxBodyBytes, request.signal));
      else if (op === 'result') { body = parseReply(await readJsonBody(request, maxResultBytes, request.signal)); id = body.connectionId; }
      else id = parseConnection(url.searchParams.get('connectionId'));
    } catch (error) { return response(guardStatus(error)); }
    if (op === 'open') {
      if (body.target.subject.scopeId !== access.identity.scopeId) return response(403);
      const permitted = await allowed(access.identity, body.target, 'open', null);
      if (!permitted || access.revoked.aborted || request.signal.aborted) return response(403);
      if (closed) return response(410);
      if (connections.size >= maxConnections) return response(429);
      const connection = attach(access.identity, body.target, access.revoked);
      return response(200, { schema, version, connectionId: connection.id, target: connection.target });
    }
    const connection = connections.get(id);
    if (!connection) return response(410);
    if (!sameIdentity(connection.identity, access.identity)) return response(403);
    if (access.revoked.aborted || request.signal.aborted) return response(403);
    if (op === 'poll') return connection.poll(request, access);
    if (op === 'close') { connection.close(); return response(204); }
    const revoke = () => connection.close();
    access.revoked.addEventListener('abort', revoke, { once: true });
    request.signal.addEventListener('abort', revoke, { once: true });
    try { return await connection.result(body, access, request); }
    finally { access.revoked.removeEventListener('abort', revoke); request.signal.removeEventListener('abort', revoke); }
  }
  return { handle, getConnection: id => {
    const connection = connections.get(id);
    if (!connection) return undefined;
    const { select, propose, close } = connection;
    return { id, identity: connection.identity, target: connection.target, select, propose, close };
  }, close: () => { closed = true; for (const connection of connections.values()) connection.close(); } };
}
