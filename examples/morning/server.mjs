import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { validateExperience } from '@hachej/boring-ui-kit/experience/compose';
import { readJsonBody, RequestGuardError, guardStatus } from '@hachej/boring-files/request-guard';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { webRequest, sendWebResponse } from '@hachej/boring-files/node-http';
import { openMorningRuntime } from './runtime.mjs';
import { morningIdentity, morningActionDigest } from './documents.mjs';
import { composeMorning, fakeMorningEvaluator, morningLayout, morningMetadata, morningCells } from './composition.mjs';

const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const denied = () => json({ kind: 'denied', reason: 'Morning operation is not authorized' });
export function createMorningHandler({ runtime, identity = morningIdentity, getOrigin, evaluate = fakeMorningEvaluator, canView = () => true, beforeCompose }) {
  const owners = { 'morning/header': 'layout', 'morning/reply': 'email', 'email/reply': 'email', 'calendar/conflict': 'calendar', 'todo/morning': 'todo' };
  const visible = ref => Object.hasOwn(owners, ref) && runtime.canRead(owners[ref], identity) && canView(ref) === true;
  const authenticate = async request => request.headers.get('authorization') === 'Bearer fictional-morning' && request.headers.get('origin') === getOrigin() ? identity : null;
  const resource = getClient => createResourceHandler({ authenticate, reader: { read: (request, access) => getClient(access).read(request) },
    publisher: { publish: (request, access) => getClient(access).publish(request) }, lookup: { lookup: (id, access) => getClient(access).lookup(id) }, maxRequestBytes: 1048576 });
  const resources = new Map([['/draft', resource(access => runtime.draftClient(access))], ['/layout', resource(access => runtime.layoutClient(access))]]);
  const routes = new Map([
    ['/email/read', () => runtime.email.read(identity)], ['/calendar/read', () => runtime.calendar.read(identity)], ['/todo/read', () => runtime.todo.read(identity)],
    ['/email/send', input => runtime.email.send(input, identity)], ['/email/snooze', input => runtime.email.snooze(input, identity)],
    ['/calendar/slot', input => runtime.calendar.acceptSlot(input, identity)], ['/todo/tick', input => runtime.todo.setCompleted(input, identity)],
  ]);
  return async request => {
    const path = new URL(request.url).pathname;
    if (resources.has(path)) return resources.get(path)(request);
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (!await authenticate(request)) return new Response(null, { status: 403 });
    try {
      const input = await readJsonBody(request, 1048576, request.signal);
      if (input === null || typeof input !== 'object' || Array.isArray(input)) return denied();
      if (path === '/configuration') {
        if (Object.keys(input).length) return denied();
        return json({ identity, draftTarget: runtime.draftTarget, layoutTarget: runtime.layoutTarget });
      }
      if (path.endsWith('/read')) { if (Object.keys(input).length) return denied(); }
      if (routes.has(path)) {
        if (!path.endsWith('/read')) {
          try {
            const match = typeof input.operationId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:([0-9a-f]{64})$/.exec(input.operationId);
            if (!match || match[1] !== await morningActionDigest(path, input)) return denied();
          } catch { return denied(); }
        }
        try { return json(await routes.get(path)(input)); }
        catch { return json(input.operationId ? { kind: 'unknown', operationId: input.operationId, reason: 'Application result unconfirmed; reconcile without replay' } : { kind: 'unavailable', reason: 'Morning read unavailable' }); }
      }
      const app = new Map([['/email/lookup', runtime.email], ['/calendar/lookup', runtime.calendar], ['/todo/lookup', runtime.todo]]).get(path);
      if (app) {
        if (Object.keys(input).length !== 1 || typeof input.operationId !== 'string' || !input.operationId || input.operationId.length > 256) return denied();
        return json(await app.lookup(input.operationId, identity));
      }
      if (path === '/compose') {
        if (Object.keys(input).sort().join(',') !== 'descriptor,trigger' || !['request', 'phase', 'open'].includes(input.trigger)) return denied();
        await beforeCompose?.(request.signal);
        request.signal.throwIfAborted();
        const records = await Promise.all([runtime.email.read(identity), runtime.calendar.read(identity), runtime.todo.read(identity)]);
        if (records.some(record => record.kind !== 'available')) return denied();
        const metadata = morningMetadata({ email: records[0].document, calendar: records[1].document, todo: records[2].document });
        const snapshots = [];
        for await (const snapshot of composeMorning({ descriptor: input.descriptor, metadata, trigger: input.trigger, canView: visible, evaluate, signal: request.signal })) snapshots.push(snapshot);
        for (const snapshot of snapshots) if (snapshot.descriptor) {
          try { validateExperience(snapshot.descriptor, { cells: morningCells, canView: visible }); }
          catch { return denied(); }
        }
        return json({ kind: 'composed', snapshots });
      }
      return new Response(null, { status: 404 });
    } catch (error) { return error instanceof RequestGuardError ? new Response(null, { status: guardStatus(error) }) : json({ kind: 'unavailable', reason: 'Morning operation unavailable; reconcile any possible publication' }); }
  };
}

export async function startMorningServer({ runtime, identity = morningIdentity, evaluate, canView, beforeCompose, port = 0, host = '127.0.0.1' }) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-morning-assets-'));
  let origin, closed = false;
  const handler = createMorningHandler({ runtime, identity, evaluate, canView, beforeCompose, getOrigin: () => origin });
  let bundle;
  try { bundle = await build({ entryPoints: [fileURLToPath(new URL('./view.jsx', import.meta.url))], outdir: directory, entryNames: 'view', bundle: true, platform: 'browser', format: 'esm', metafile: true, define: { 'process.env.NODE_ENV': '"production"' } }); }
  catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
  const server = createServer(async (incoming, outgoing) => {
    const abort = new AbortController(); outgoing.on('close', () => { if (!outgoing.writableEnded) abort.abort(); });
    try {
      const url = new URL(incoming.url, origin);
      if (url.pathname === '/') { await sendWebResponse(new Response('<!doctype html><title>Fictional morning</title><div id="root"></div><script type="module" src="/view.js"></script>', { headers: { 'content-type': 'text/html' } }), outgoing); return; }
      if (url.pathname === '/view.js' || url.pathname === '/view.css') { await sendWebResponse(new Response(readFileSync(join(directory, url.pathname.slice(1))), { headers: { 'content-type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' } }), outgoing); return; }
      const request = await webRequest(incoming, url, { maxBytes: 1048576, signal: abort.signal });
      await sendWebResponse(request ? await handler(request) : new Response(null, { status: 413 }), outgoing, { signal: abort.signal });
    } catch { if (!outgoing.destroyed) outgoing.end(); }
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); }
  catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
  origin = `http://${host}:${server.address().port}`;
  return { origin, bundle: bundle.metafile, handler, close: async () => { if (closed) return; closed = true; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = await openMorningRuntime({ directory: resolve('.cache/morning-demo'), layout: morningLayout });
  try { await runtime.prepare(); const server = await startMorningServer({ runtime, port: Number(process.env.PORT ?? 3000) }); console.log(`Fictional morning: ${server.origin}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); await runtime.close(); process.exit(0); });
  } catch (error) { await runtime.close(); throw error; }
}
