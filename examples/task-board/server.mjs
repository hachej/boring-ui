import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Harness, MemoryStorage, createRegistry, defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { createPresentTool, answerViewOpen } from '@hachej/boring-agent/artifacts';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { webRequest, sendWebResponse } from '@hachej/boring-files/node-http';
import { rejectForeignHost, sameSecret } from '../../shared/local-host.mjs';
import { createScriptedModels } from '../../lab/studio/scripted-model.mjs';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';
import { taskSources } from './script.mjs';
import { evidenceImage } from './evidence-image.mjs';

/** One native conversation, one real workspace provider, fictional records and a keyless scripted model. */
export async function startTaskBoard({ port = 0 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-task-board-'));
  const root = join(directory, 'workspace'); mkdirSync(root);
  const human = { scopeId: 'village', principalId: 'alice', initiatorId: 'alice' };
  const env = new NodeExecutionEnv({ cwd: root });
  const db = openNodeConnection(join(directory, 'workspace.sqlite'));
  const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: 'task-board', incarnation: 'fixture', viewId: 'published' }, fs: env, journal: createWorkspaceJournal(db) });
  const contents = [
    ['brief.md', new TextEncoder().encode('# Picnic route\n\nA fictional riverside outing. Bring water and a sun hat.\n'), 'text/markdown'],
    ['mockup.html', new TextEncoder().encode('<!doctype html><html><body><h1>Riverside picnic</h1><p>Meet at the imaginary west gate at noon.</p></body></html>'), 'text/html'],
    ['evidence.png', evidenceImage(), 'image/png'],
  ];
  for (const [name, bytes, mediaType] of contents) {
    const result = await files.publication.publish({ operationId: `seed-${name}`, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: { resource: { providerId: 'workspace', path: `docs/tasks/D-201/${name}` }, view: { kind: 'published' } }, expected: { kind: 'absent' }, bytes, mediaType }] }, human);
    if (result.kind !== 'committed') throw new Error(`Could not seed ${name}`);
  }
  const { models } = await createScriptedModels({ sources: taskSources });
  const registry = createRegistry();
  const answers = new Map();
  const settle = (task, question, value, actor) => {
    const options = { route: ['river', 'hill'], supplies: ['water', 'snacks'] };
    if (task !== 'D-201' || !options[question]?.includes(value)) return { kind: 'denied', reason: 'Unknown task question or option' };
    const answer = { answer: value, answeredBy: actor, answeredAt: new Date().toISOString() }; answers.set(question, answer); return { kind: 'answered', question, ...answer };
  };
  const answerQuestion = defineTool({ name: 'answer_task_question', description: 'Settle a fictional host question. Not an approval or task execution.', replay: 'safe', parameters: Type.Object({ task: Type.String(), question: Type.String(), value: Type.String() }), execute: async args => ({ output: [{ type: 'text', text: JSON.stringify(settle(args.task, args.question, args.value, 'PM')) }] }) });
  const agent = defineAgent({ id: 'village-pm', model: { provider: 'openai', modelId: 'gpt-5-mini' }, instructions: 'Show the requested fictional host task, then report the actual presentation result.', tools: [createPresentTool({ ack: { timeoutMs: 15000 } }), answerQuestion] });
  agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  const conversation = await agent.createConversation(harness, context); harness.resume();
  const token = randomUUID();
  const authenticated = request => sameSecret(request.headers.get('authorization'), `Bearer ${token}`);
  const chat = createChatTransportHandler({ authenticate: async request => authenticated(request) ? { conversation, context, abortSubmission: id => harness.abortSubmission(id, context, conversation.id), answer: (id, body) => answerViewOpen(conversation, id, body) } : null });
  // Only the adapter-authorized task folder is readable. A path from the browser never grants access.
  const allowedPaths = new Set(contents.map(([name]) => `docs/tasks/D-201/${name}`));
  const reader = { read: (request, access) => allowedPaths.has(request.target.resource.path) ? files.read(request, access) : Promise.resolve({ kind: 'denied', reason: 'Task folder not authorized' }) };
  const resources = createResourceHandler({ authenticate: async request => authenticated(request) ? human : null, reader });
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./page.tsx', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', alias: { '@': fileURLToPath(new URL('../app-shell', import.meta.url)) }, define: { 'process.env.NODE_ENV': '"production"' }, minify: true, logLevel: 'silent', metafile: true });
  const css = await buildTailwind({ extraDirectories: ['examples/task-board', 'registry/task-board'], extraCss: '@layer base { @import "tailwindcss/preflight.css"; }' });
  const boot = { token, conversationId: String(conversation.id), identity: { runtimeId: 'task-board', ...human } };
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional task board</title><link rel="stylesheet" href="/app.css"></head><body class="m-0 bg-background text-foreground font-sans"><div id="root"></div><script>window.__TASK_BOARD__=${JSON.stringify(boot)}</script><script type="module" src="/page.js"></script></body></html>`;
  const statics = { '/': ['text/html; charset=utf-8', page], '/page.js': ['text/javascript', bundle.outputFiles[0].contents], '/app.css': ['text/css', css] };
  const server = createServer(async (incoming, outgoing) => {
    if (rejectForeignHost(incoming, outgoing)) return;
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    const closed = new AbortController(); outgoing.on('close', () => closed.abort());
    try {
      const fixed = incoming.method === 'GET' && statics[url.pathname];
      if (fixed) return void outgoing.writeHead(200, { 'content-type': fixed[0], 'cache-control': 'no-store' }).end(fixed[1]);
      const request = await webRequest(incoming, url, { signal: closed.signal });
      if (!request) return void outgoing.writeHead(413).end();
      const response = url.pathname === '/api/answers' && authenticated(request) ? request.method === 'POST' ? await (async () => { const input = await request.json(); return Response.json(settle(input.task, input.question, input.value, 'Alice')); })() : Response.json(Object.fromEntries(answers)) : url.pathname === '/api/chat' ? await chat(request) : url.pathname === '/api/resources' ? await resources(request) : Response.json({ reason: 'not-found' }, { status: 404 });
      await sendWebResponse(response, outgoing, { signal: closed.signal });
    } catch (error) { if (!closed.signal.aborted) console.error(error); if (!outgoing.headersSent) outgoing.writeHead(500); outgoing.end(); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  return { url: `http://127.0.0.1:${server.address().port}/`, metafile: bundle.metafile, conversation,
    view: async () => (await conversation.watch(context)).value,
    close: async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); await harness.close(context); db.close(); rmSync(directory, { recursive: true, force: true }); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startTaskBoard({ port: Number(process.env.PORT ?? 4322) }); console.log(`Fictional tasks: ${app.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().finally(() => process.exit(0)); });
}
