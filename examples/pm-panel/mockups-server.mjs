// Native Harness/SQLite + exact resource HTTP fixture. These are local seeded attachment stand-ins, not the Factory Task Worker.
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Harness, createRegistry, defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { createPresentTool } from '@hachej/boring-agent/artifacts';
import { createAskUserTool, answerUserQuestion } from '@hachej/boring-agent/ask-user';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createRevisionHandler } from '@hachej/boring-files/revision-handler';
import { webRequest, sendWebResponse } from '@hachej/boring-files/node-http';
import { rejectForeignHost } from '../../shared/local-host.mjs';
import { createScriptedModels } from '../../lab/studio/scripted-model.mjs';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';
import { COACH_THEME } from './server.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
export async function startMockups() {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-pm-mockups-'));
  const root = join(directory, 'workspace'); mkdirSync(root);
  const env = new NodeExecutionEnv({ cwd: root });
  const access = { scopeId: 'fictional-app', principalId: 'fictional-requester', initiatorId: 'fictional-requester' };
  const identity = { runtimeId: 'fictional-runtime', ...access };
  const db = openNodeConnection(join(directory, 'files.sqlite'));
  const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: 'mockups', incarnation: 'mockups', viewId: 'published' }, fs: env, journal: createWorkspaceJournal(db) });
  const task = { id: randomUUID(), marked_for_build: false, launch_answer: null };
  const comments = [], reads = [];
  const attachments = [];
  for (const [index, label] of ['A — liste compacte', 'B — cartes', 'C — journal'].entries()) {
    const title = `Piste ${label}`;
    const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font:16px/1.5 system-ui;margin:0;padding:24px;background:#fff;color:#18181b}h1{font-size:24px}article{border:1px solid #d4d4d8;border-radius:${index * 8}px;padding:20px;margin:12px 0}small{color:#52525b}</style><main><small>ATELIER FICTIF · OPTION ${index + 1}</small><h1>${title}</h1><article>Carnet des idées<br>Une idée claire à la fois</article><article>Prochaine étape<br>Choisir, sans lancer de travail</article></main></html>`;
    const path = `mockups/${task.id}/${createHash('sha256').update(html).digest('hex')}.html`;
    const saved = await files.publication.publish({ operationId: `attachment-${index}`, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: { resource: { providerId: files.providerId, path }, view: { kind: 'published' } }, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(html), mediaType: 'text/html' }] }, access);
    if (saved.kind !== 'committed') throw new Error('Fixture attachment seed failed');
    attachments.push({ title, path, revision: saved.receipt.changes[0].after.revision });
  }
  const comment = defineTool({ name: 'tasks_comment', description: 'Record a fictional design choice, not launch consent.', replay: 'safe', parameters: Type.Object({ text: Type.String() }), execute: async ({ text }) => {
    comments.push({ task: task.id, requester: access.principalId, text });
    return { output: [{ type: 'text', text: JSON.stringify({ commented: true }) }] };
  } });
  const { models } = await createScriptedModels({ sources: [{ name: 'mockups', entries: [{ match: 'maquettes fictives', turns: [
    { text: 'Voici trois pistes fictives.', tools: attachments.map(item => ({ name: 'present', args: { path: item.path } })) },
    { text: 'Votre choix ne lance aucun travail.', tools: [{ name: 'ask_user', args: { question: 'Quelle piste préférez-vous ?', options: attachments.map(item => `${item.title} · ${item.path}`) } }] },
    ctx => ({ tools: [{ name: 'tasks_comment', args: { text: `Choix de maquette : ${ctx.last?.json?.answer}` } }] }),
    'Choix noté. La demande reste à confirmer.',
  ] }] }] });
  const present = createPresentTool({ workspace: { files, root, access } });
  // The Factory adds human titles to native descriptors; this fixture supplies its seeded attachment's title.
  const titledPresent = { ...present, execute: async (args, api, ctx) => {
    const result = await present.execute(args, api, ctx);
    return { ...result, output: result.output.map(part => {
      if (part.type !== 'text') return part;
      const value = JSON.parse(part.text), item = attachments.find(item => item.path === args.path);
      return value.artifact && item ? { ...part, text: JSON.stringify({ ...value, artifact: { ...value.artifact, title: item.title } }) } : part;
    }) };
  } };
  const agent = defineAgent({ id: 'pm', model: { provider: 'openai', modelId: 'gpt-5-mini' }, instructions: 'Fictional PM fixture.', tools: [titledPresent, createAskUserTool(), comment], extensions: [] });
  const registry = createRegistry(); agent.install(registry);
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models, env: () => env }, context);
  const conversation = await agent.createConversation(harness, context); harness.resume();
  const signedIn = request => request.headers.get('sec-fetch-site') === 'same-origin';
  const chat = createChatTransportHandler({ authenticate: async request => signedIn(request) && new URL(request.url).searchParams.get('conversation') === String(conversation.id) ? {
    conversation, context, abortSubmission: submission => harness.abortSubmission(submission, context, conversation.id), answer: (callId, answer) => answerUserQuestion(conversation, callId, answer),
  } : null });
  const resources = createRevisionHandler({ resolve: async request => signedIn(request) ? { provider: files, access } : null });
  const bundle = await build({ entryPoints: [here('./mockups.tsx')], bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', alias: { '@': here('../app-shell') }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const css = await buildTailwind({ extraDirectories: ['examples/pm-panel', 'registry/pm-panel', 'registry/task-board', 'registry/task-mentions'] });
  const page = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maquettes fictives</title><link rel="stylesheet" href="/app.css"><body style="margin:0"><div id="root"></div><script>window.__MOCKUPS__=${JSON.stringify({ identity, conversationId: String(conversation.id) })}</script><script type="module" src="/app.js"></script></body></html>`;
  const server = createServer(async (incoming, outgoing) => {
    if (rejectForeignHost(incoming, outgoing)) return;
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    const stop = new AbortController(); outgoing.on('close', () => stop.abort());
    try {
      const fixed = { '/': ['text/html', page], '/app.js': ['text/javascript', bundle.outputFiles[0].text], '/app.css': ['text/css', `${css}\n${COACH_THEME}`] }[url.pathname];
      if (fixed) return void outgoing.writeHead(200, { 'content-type': fixed[0] }).end(fixed[1]);
      const request = await webRequest(incoming, url, { signal: stop.signal });
      let response;
      if (url.pathname === '/api/pm/chat') response = await chat(request);
      else if (url.pathname === '/api/pm/resources') {
        const body = request.method === 'POST' ? await request.clone().json() : undefined;
        reads.push({ method: request.method, body });
        // Attachments are read-only; browser cannot publish, rename, delete or request latest.
        response = body && (body.kind !== 'read' || body.value?.revision?.kind !== 'exact') ? new Response(null, { status: 403 }) : await resources(request);
      } else response = new Response(null, { status: 404 });
      await sendWebResponse(response, outgoing, { signal: stop.signal });
    } catch (error) { if (!stop.signal.aborted) console.error(error); if (!outgoing.headersSent) outgoing.writeHead(500); outgoing.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, task, comments, attachments, reads, close: async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await harness.close(context); files.close(); db.close(); rmSync(directory, { recursive: true, force: true });
  } };
}
