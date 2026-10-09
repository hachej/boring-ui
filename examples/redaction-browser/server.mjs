import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readJsonBody, RequestGuardError, guardStatus } from '@hachej/boring-files/request-guard';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { webRequest, sendWebResponse } from '@hachej/boring-files/node-http';
import { redactionActor } from '../redaction/app.mjs';
import { actorSnapshot } from '../redaction/bindings.mjs';
import { openRedactionBrowser } from './runtime.mjs';
import { fakePreparationEvaluator } from './preparation-composition.mjs';
import { matchesActionRequestId } from './action-binding.mjs';

const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === (keys ? keys.split(',') : []).sort().join(',');
const expected = value => exact(value, 'kind,target') && ['absent', 'revision'].includes(value.kind);
const choices = value => Array.isArray(value) && value.length >= 1 && value.length <= 2 && value.every(item => exact(item, 'itemId,kind'));
const corrections = value => Array.isArray(value) && value.length >= 1 && value.length <= 2 && value.every(item => exact(item, 'itemId,expected') && expected(item.expected));
const generation = value => exact(value, 'instanceId,subject,requestId,source,config,generation,edit,output') && [value.generation, value.edit, value.output].every(expected);
const proposal = value => exact(value, 'instanceId,subject,requestId,generationId,reservation,guard,actor,producer,delivery,operationId,validation,formatter');
const adoption = value => exact(value, 'instanceId,subject,requestId,proposal,choices,corrections,record,letter') && proposal(value.proposal) && choices(value.choices) && corrections(value.corrections) && expected(value.record) && expected(value.letter);

export function createRedactionBrowserHandler({ runtime, identity = redactionActor(), getOrigin, evaluation = { kind: 'local' } }) {
  const actor = actorSnapshot(identity);
  const authenticate = async request => request.headers.get('authorization') === 'Bearer fictional-redaction' && request.headers.get('origin') === getOrigin() ? { ...actor } : null;
  const resources = new Map();
  for (const id of ['first', 'second']) for (const resource of ['notes', 'letter-A', 'letter-B', 'letter-C', 'record-A', 'record-B', 'record-C', 'preparation', 'preparation-layout']) {
    resources.set(`/consultations/${id}/${resource}`, createResourceHandler({ authenticate,
      reader: { read: (request, access) => runtime.resourceClient(id, resource, access).read(request) },
      ...(!resource.startsWith('record-') && resource !== 'preparation' ? { publisher: { publish: (request, access) => runtime.resourceClient(id, resource, access).publish(request) }, lookup: { lookup: (operationId, access) => runtime.resourceClient(id, resource, access).lookup(operationId) } } : {}), maxRequestBytes: 32768 }));
  }
  return async request => {
    const path = new URL(request.url).pathname;
    if (resources.has(path)) return resources.get(path)(request);
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (!await authenticate(request)) return new Response(null, { status: 403 });
    try {
      const input = await readJsonBody(request, 32768, request.signal);
      if (path === '/configuration') return exact(input, '') ? json(await runtime.configuration(actor)) : new Response(null, { status: 400 });
      const matched = /^\/consultations\/(first|second)\/([a-z-]+)$/.exec(path);
      if (!matched) return new Response(null, { status: 404 });
      const [, id, route] = matched;
      let call;
      switch (route) {
        case 'preparation-capture': if (exact(input, 'requestId,source,saveOperationId')) call = () => runtime.preparationCapture(id, input, actor); break;
        case 'preparation-admit': if (exact(input, 'instanceId,requestId,notes,dossier,config,generation,output') && expected(input.generation) && expected(input.output)) call = () => runtime.preparationAdmit(id, input, actor); break;
        case 'preparation-latest': if (exact(input, '')) call = () => runtime.preparationLatest(id, actor); break;
        case 'preparation-result': if (exact(input, 'instanceId,requestId,generationId,actor,reservation,guard,producer,validation,delivery,operationId')) call = () => runtime.preparationResult(id, input, actor); break;
        case 'preparation-compose': if (exact(input, 'preparation,descriptor,trigger')) call = () => runtime.preparationCompose(id, input, actor, { evaluation, signal: request.signal }); break;
        case 'capture': if (exact(input, 'subject,requestId,source,saveOperationId')) call = () => runtime.capture(id, input, actor); break;
        case 'admit': if (generation(input)) call = () => runtime.admit(id, input, actor); break;
        case 'view': if (proposal(input)) call = () => runtime.view(id, input, actor); break;
        case 'latest': if (exact(input, 'subject')) call = () => runtime.latest(id, input.subject, actor); break;
        case 'correct': if (exact(input, 'ref,options') && proposal(input.ref) && exact(input.options, 'requestId,itemId,expected,text') && expected(input.options.expected) && await matchesActionRequestId(input.options.requestId, 'correct', id, actor, { ref: input.ref, options: { itemId: input.options.itemId, expected: input.options.expected, text: input.options.text } })) call = () => runtime.correct(id, input, actor); break;
        case 'capture-adoption': if (exact(input, 'ref,choices,requestId,letter,record,corrections') && proposal(input.ref) && choices(input.choices) && corrections(input.corrections) && expected(input.letter) && expected(input.record) && await matchesActionRequestId(input.requestId, 'adopt', id, actor, { ref: input.ref, choices: input.choices, letter: input.letter, record: input.record, corrections: input.corrections })) call = () => runtime.captureAdoption(id, input, actor); break;
        case 'adopt': if (adoption(input) && await matchesActionRequestId(input.requestId, 'adopt', id, actor, { ref: input.proposal, choices: input.choices, letter: input.letter, record: input.record, corrections: input.corrections })) call = () => runtime.adopt(id, input, actor); break;
        case 'adoption-result': if (exact(input, 'instanceId,subject,requestId,taskId,operationId,actor')) call = () => runtime.adoptionResult(id, input, actor); break;
        case 'transcribe': if (exact(input, 'requestId,recordingId')) call = () => runtime.transcribe(id, input, actor, request.signal); break;
        default: return new Response(null, { status: 404 });
      }
      if (!call) return new Response(null, { status: 400 });
      return json(await call());
    } catch (error) {
      return error instanceof RequestGuardError ? new Response(null, { status: guardStatus(error) })
        : json({ kind: 'unknown', reason: 'Redaction response unavailable; retain the original request before retrying' });
    }
  };
}

export async function startRedactionBrowserServer({ runtime, identity = redactionActor(), port = 0, host = '127.0.0.1', evaluation = { kind: 'local' } }) {
  const directory = mkdtempSync(join(tmpdir(), 'redaction-browser-assets-'));
  let origin, closed = false, bundle;
  const handler = createRedactionBrowserHandler({ runtime, identity, evaluation, getOrigin: () => origin });
  try { bundle = await build({ entryPoints: [fileURLToPath(new URL('./view.jsx', import.meta.url))], outdir: directory, entryNames: 'view', bundle: true, platform: 'browser', format: 'esm', metafile: true, define: { 'process.env.NODE_ENV': '"production"' } }); }
  catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
  const server = createServer(async (incoming, outgoing) => {
    const abort = new AbortController(); outgoing.on('close', () => { if (!outgoing.writableEnded) abort.abort(); });
    try {
      const url = new URL(incoming.url, origin);
      if (url.pathname === '/') { await sendWebResponse(new Response('<!doctype html><title>Fictional redaction</title><div id="root" data-redaction-root></div><script type="module" src="/view.js"></script>', { headers: { 'content-type': 'text/html' } }), outgoing); return; }
      if (url.pathname === '/view.js' || url.pathname === '/view.css') { await sendWebResponse(new Response(readFileSync(join(directory, url.pathname.slice(1))), { headers: { 'content-type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' } }), outgoing); return; }
      const request = await webRequest(incoming, url, { maxBytes: 32768, signal: abort.signal });
      await sendWebResponse(request ? await handler(request) : new Response(null, { status: 413 }), outgoing, { signal: abort.signal });
    } catch { if (!outgoing.destroyed) outgoing.end(); }
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); }
  catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
  origin = `http://${host}:${server.address().port}`;
  return { origin, handler, bundle: bundle.metafile, close: async () => { if (closed) return; closed = true; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = await openRedactionBrowser({ directory: resolve('.cache/redaction-browser-demo') });
  try {
    const server = await startRedactionBrowserServer({ runtime, port: Number(process.env.PORT ?? 3001), evaluation: { kind: 'fake', evaluate: fakePreparationEvaluator } });
    console.log(`Fictional redaction: ${server.origin}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); await runtime.close(); process.exit(0); });
  } catch (error) { await runtime.close(); throw error; }
}
