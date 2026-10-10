// AWS host recipe: the standard agent (../shared/standard-agent.mjs) behind the AgentCore Runtime HTTP contract
// (`GET /ping`, `POST /invocations` on 0.0.0.0:8080). The same process runs as a plain ECS service behind a load balancer.
//
// One process, one native Harness for every user. The workspace of each call comes with its env, like Pi's own
// `HarnessOptions.env(target, context)` (docs/architecture/FILES-GIT-EXEC.md, "Workspace per call"): the harness's `env` resolves the
// conversation's owner (its managed metadata, `<user>/<key>`) to that user's workspace, opened by one `createWorkspaceCache` entry,
// and every tool (the file guard, `present`, Pi's read/write/edit, bash) uses the workspace attached to the env of its call.
// Per user (the verified token's `sub`, mapped by the host to a POSIX uid and an EFS access point when the workspace opens):
//   - the workspace is the user's folder on the shared EFS file system: `/mnt/efs/users/<id>` here, `/mnt/workspace`
//     inside the user's Code Interpreter session (its own access point, root `/users/<id>`): the same files on both sides;
//   - commands run in that Code Interpreter session (`@hachej/boring-execution/aws-code-interpreter`), files are read and written
//     on this host's mount, and the workspace provider (viewer, `present`, the file guard) reads the same folder;
//   - the provider's journal is `/mnt/efs/state/<id>/journal.sqlite`, which the interpreter cannot reach. The workspace (session,
//     provider, journal) opens on the user's first call or request and closes after `workspaceIdleMs` with no request and no
//     live work; the next use reopens it over the same files.
// Pi's own storage is one file, `/mnt/efs/state/harness.pi.sqlite`, written by this one process: on ECS one task (never two during
// a deployment), on AgentCore Runtime one session for the host (`RUNTIME_SESSION_ID`). Every SQLite file on EFS is opened with
// `sqliteSettings.networkFilesystem` (rollback journal, lock held from open to close, full sync; never WAL on NFS); a second
// opener of a held file gets `SqliteLockedError`, not a shared write. A harness per conversation key instead: README, "Harness per owner".
//
// `POST /invocations` carries one chat transport operation in its JSON body, because AgentCore routes only that path:
//   { op: 'watch' | 'entries' | 'submission', conversation?: 'main', params?: { ... } }          read operations
//   { op: 'submit' | 'abort' | 'answer' | 'configure' | 'withdraw', conversation?, input: { ... } }   effects
//   { op: 'files' } and { op: 'file', params: { path } }                                     the workspace as the viewer reads it
// Fictional content only. Nothing here creates AWS resources or credentials; see ./README.md.
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { answerUserQuestion } from '@hachej/boring-agent/ask-user';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { conversationMetadata, createConversations } from '@hachej/boring-agent/conversations';
import { createWorkspaceCache, rootConversation } from '@hachej/boring-agent/workspaces';
import { openNodeConnection, sqliteSettings } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider, isTemporary } from '@hachej/boring-files/workspace';
import { createCodeInterpreterEnv, efsUserLayout } from '@hachej/boring-execution/aws-code-interpreter';
import { defineStandardAgent } from '../shared/standard-agent.mjs';
import { openPiStorage } from '../shared/pi-storage.mjs';
import { readFiles, shell, writeFiles } from '../shared/workspace-tools.mjs';
import { configureOffered } from '../shared/conversation-host.mjs';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { createJwtVerifier } from './jwt.mjs';

const READS = new Set(['watch', 'entries', 'submission']), EFFECTS = new Set(['submit', 'abort', 'answer', 'configure', 'withdraw']);
const KEY = /^[a-z0-9_-]{1,64}$/;
const SESSION_HEADER = 'x-amzn-bedrock-agentcore-runtime-session-id';

/** The one AgentCore `runtimeSessionId` of this host: every client sends it, so one microVM (the one writer of Pi's file) serves everyone. */
export const RUNTIME_SESSION_ID = 'boring-host-00000000000000000000000000001';

/**
 * @param {object} options
 * @param {(userId: string) => Promise<{ uid: number, accessPointArn: string, fileSystemArn: string } | null>} options.users host policy:
 *   whether the user (the token's `sub`) may use the agent, and their folder; asked on every request and whenever their workspace opens
 * @param {(token: string) => Promise<object | null>} options.verifyToken
 * @param {{ client: object, identifier: string, sessionTimeoutSeconds?: number, pollIntervalMs?: number }} options.codeInterpreter
 */
export async function startAwsHost({ port = 8080, hostname = '0.0.0.0', efsRoot = '/mnt/efs', interpreterMountPath = '/mnt/workspace', users, verifyToken,
  codeInterpreter, models, model, offered = [model], requireSessionHeader = false, sqlite = sqliteSettings.networkFilesystem, workspaceIdleMs = 10 * 60_000 }) {
  const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  let harness;

  /**
   * One user's workspace: their folder, their Code Interpreter session (started on the first command with their own access point,
   * looked up now, never at startup), one provider over that env and its journal. The cache attaches it to the env (`withWorkspace`).
   */
  async function openWorkspace(userId) {
    const entry = await users(userId);
    if (!entry) throw new Error(`User ${userId} has no workspace`);
    const layout = efsUserLayout({ userId, uid: entry.uid, runtimeMountPath: efsRoot, interpreterMountPath });
    // The folder may exist already (the access point creates it on the interpreter's first mount); either way it keeps the
    // shared group with setgid, so files written on either side stay writable by the other (umask 002 on both).
    mkdirSync(layout.runtime.root, { recursive: true }); chmodSync(layout.runtime.root, 0o2770);
    mkdirSync(layout.runtime.state, { recursive: true, mode: 0o700 });
    const interpreter = createCodeInterpreterEnv({ client: codeInterpreter.client, codeInterpreterIdentifier: codeInterpreter.identifier, id: layout.namespaceId,
      session: { start: { name: `boring-${userId}`.slice(0, 48), sessionTimeoutSeconds: codeInterpreter.sessionTimeoutSeconds ?? 3600,
        filesystemConfigurations: [layout.filesystemConfiguration({ accessPointArn: entry.accessPointArn, fileSystemArn: entry.fileSystemArn })] } },
      mount: { path: layout.interpreter.mountPath, root: layout.runtime.root },
      ...(codeInterpreter.pollIntervalMs ? { pollIntervalMs: codeInterpreter.pollIntervalMs } : {}) });
    const database = openNodeConnection(layout.runtime.journal, sqlite);
    const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: layout.namespaceId, incarnation: 'aws', viewId: 'published' }, fs: interpreter.env, journal: createWorkspaceJournal(database) });
    return { id: layout.namespaceId, files, root: layout.interpreter.mountPath, env: interpreter.env, access: { scopeId: userId, principalId: 'agent', initiatorId: userId },
      userId, layout, interpreter, database,
      close: async () => { try { await interpreter.stop(context); } finally { database.close(); } } };
  }

  /** The user a conversation belongs to: the owner `<user>/<key>` its managed metadata names (a key has no '/', a user id may). */
  const owners = new Map();
  async function userOfConversation(conversationId, callContext) {
    const known = owners.get(String(conversationId));
    if (known) return known;
    const root = await rootConversation(harness, conversationId, callContext);
    const owner = (await harness.snapshot(conversationMetadata, root, callContext))?.owner ?? '';
    const userId = owner.includes('/') ? owner.slice(0, owner.lastIndexOf('/')) : undefined;
    if (userId) owners.set(String(conversationId), userId);
    return userId;
  }
  const workspaces = createWorkspaceCache({
    key: (target, callContext) => userOfConversation(target.conversationId, callContext),
    open: userId => openWorkspace(userId),
    idleMs: workspaceIdleMs,
    // Pi does not report when a call stops using its env: a workspace stays open while the harness has live work.
    // Per workspace: only live work of this user's conversations keeps their workspace open.
    busy: async userId => {
      const inspection = await harness.inspect(context);
      if (!inspection) return false;
      const ids = new Set([...inspection.tasks.map(task => task.record.conversationId), ...inspection.submissions.map(submission => submission.conversationId)]);
      for (const id of ids) if (await userOfConversation(id, context) === userId) return true;
      return false;
    },
    onError: (error, userId) => console.error(`closing the workspace of ${userId}:`, error?.message ?? error),
  });

  // One agent for everyone: no tool names a workspace, each uses the one attached to its call's env.
  const { agent } = defineStandardAgent({ id: 'standard-aws', model, cwd: interpreterMountPath, root: interpreterMountPath, workspace: 'env',
    parts: [{ capabilities: ['workspace'], extensions: [readFiles, writeFiles] }, { capabilities: ['shell'], extensions: [shell] }] });
  const registry = createRegistry();
  agent.install(registry);
  harness = await Harness.open(await openPiStorage(join(efsRoot, 'state', 'harness.pi.sqlite'), sqlite), { registry, models, env: workspaces.env }, context);
  const managed = createConversations({ harness, context, onError: error => console.error('conversation metadata:', error?.message ?? error) });
  harness.resume();

  /** A user's conversation of one key: found by its durable owner `<user>/<key>`, created on first use. */
  const byOwner = new Map();
  function conversationOf(userId, key) {
    const owner = `${userId}/${key}`;
    let found = byOwner.get(owner);
    if (!found) {
      found = (async () => {
        const { items } = await managed.list({ owner, archived: 'all', limit: 1 });
        const existing = items.length ? await managed.open(owner, items[0].id) : undefined;
        const conversation = existing ?? await managed.create(owner, { start: init => agent.createConversation(harness, context, { init }) });
        owners.set(String(conversation.id), userId);
        return conversation;
      })();
      byOwner.set(owner, found);
      const created = found;
      created.catch(() => { if (byOwner.get(owner) === created) byOwner.delete(owner); });
    }
    return found;
  }

  // /ping: HealthyBusy while the harness has live tasks or unsettled submissions, so AgentCore keeps the session past its idle
  // timeout. `time_of_last_update` changes only when the status does (a timestamp that moves on every ping keeps a session alive forever).
  let status = 'Healthy', changedAt = Math.floor(Date.now() / 1000);
  async function ping() {
    const inspection = await harness.inspect(context);
    const next = inspection && (inspection.tasks.length > 0 || inspection.submissions.length > 0) ? 'HealthyBusy' : 'Healthy';
    if (next !== status) { status = next; changedAt = Math.floor(Date.now() / 1000); }
    return json({ status, time_of_last_update: changedAt });
  }

  const granted = new WeakMap();
  const chat = createChatTransportHandler({ authenticate: async request => granted.get(request) ?? null });

  async function walk(env, path, prefix = '') {
    const found = [];
    const listed = await env.listDir(path, context);
    if (!listed.ok) return found;
    for (const entry of listed.value.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git' || isTemporary(entry.name)) continue;
      if (entry.kind === 'directory') found.push(...await walk(env, entry.path, `${prefix}${entry.name}/`));
      else if (entry.kind === 'file') found.push(`${prefix}${entry.name}`);
    }
    return found;
  }

  async function invocations(request) {
    const token = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
    const claims = token ? await verifyToken(token) : null;
    if (!claims) return json({ reason: 'authentication-required' }, 401);
    const userId = typeof claims.sub === 'string' ? claims.sub : '';
    if (!userId || !await users(userId)) return json({ reason: 'not-authorized' }, 403);
    if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json({ reason: 'unsupported-media-type' }, 415);
    let body;
    try { body = await request.json(); } catch { return json({ reason: 'invalid-json' }, 400); }
    const { op, conversation: key = 'main', params = {}, input = {} } = body ?? {};
    if (typeof op !== 'string' || !KEY.test(key) || typeof params !== 'object' || params === null || Object.values(params).some(value => typeof value !== 'string')) return json({ reason: 'invalid-request' }, 400);
    // One AgentCore session for the host: a request routed to another session's microVM is refused, never served (single writer).
    const session = request.headers.get(SESSION_HEADER);
    if (session ? session !== RUNTIME_SESSION_ID : requireSessionHeader) return json({ reason: 'session-mismatch' }, 409);
    // The user's workspace, borrowed for this request (the same cache entry their calls' env comes from).
    const lease = await workspaces.acquire(userId, context);
    try {
      const { interpreter, layout, files } = lease.workspace;
      if (op === 'files') return json({ files: await walk(interpreter.env, layout.interpreter.mountPath) });
      if (op === 'file') {
        const path = params.path ?? '';
        if (!path || path.startsWith('/') || path.split('/').some(part => part === '..' || part === '')) return json({ reason: 'invalid-path' }, 400);
        const read = await files.read({ target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, { scopeId: userId, principalId: userId, initiatorId: userId });
        if (read.kind !== 'available') return json({ reason: 'not-found' }, 404);
        return json({ path, size: read.snapshot.bytes.byteLength, text: new TextDecoder().decode(read.snapshot.bytes) });
      }
    } finally { lease.release(); }
    if (!READS.has(op) && !EFFECTS.has(op)) return json({ reason: 'unknown-operation' }, 404);
    const conversation = await conversationOf(userId, key);
    const url = `http://aws.invalid/chat?${new URLSearchParams({ ...params, op })}`;
    const inner = READS.has(op) ? new Request(url, { method: 'GET', signal: request.signal })
      : new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: request.signal });
    granted.set(inner, { conversation, context,
      abortSubmission: id => harness.abortSubmission(id, context, conversation.id),
      answer: (callId, answer) => answerUserQuestion(conversation, callId, answer, context),
      configure: change => configureOffered(conversation, change, context, candidate => offered.some(item => item.provider === candidate.provider && item.modelId === candidate.modelId)) });
    return chat(inner);
  }

  const server = createServer(async (incoming, outgoing) => {
    const closed = new AbortController();
    outgoing.on('close', () => closed.abort());
    try {
      const url = new URL(incoming.url, 'http://aws.invalid');
      let response;
      if (incoming.method === 'GET' && url.pathname === '/ping') response = await ping();
      else if (incoming.method === 'POST' && url.pathname === '/invocations') {
        const request = await webRequest(incoming, url, { signal: closed.signal, maxBytes: 8 * 1024 * 1024 });
        response = request ? await invocations(request) : json({ reason: 'too-large' }, 413);
      } else response = json({ reason: 'not-found' }, 404);
      await sendWebResponse(response, outgoing, { signal: closed.signal });
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
      if (!closed.signal.aborted) console.error('request failed:', error?.message ?? error);
    }
  });
  await new Promise(resolve => server.listen(port, hostname, resolve));
  return {
    url: `http://${hostname === '0.0.0.0' ? '127.0.0.1' : hostname}:${server.address().port}`, harness, workspaces,
    stateFile: join(efsRoot, 'state', 'harness.pi.sqlite'),
    close: async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await managed.flush(); await managed.dispose();
      await harness.close(context);
      await workspaces.close();
    },
  };
}

// ---- The container entry (AgentCore Runtime or ECS). Configuration comes from the environment; see ./README.md.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const need = name => { const value = process.env[name]; if (!value) throw new Error(`Set ${name}`); return value; };
  // Files written here stay group-writable for the user's interpreter session (efsUserLayout: shared gid, setgid folders).
  process.umask(0o002);
  const efsRoot = process.env.EFS_ROOT ?? '/mnt/efs';
  // users.json: { "<sub>": { "uid": 2001, "accessPointArn": "...", "fileSystemArn": "..." } }, written when a user is provisioned.
  const usersFile = process.env.USERS_FILE ?? `${efsRoot}/state/users.json`;
  const users = async userId => {
    const all = existsSync(usersFile) ? JSON.parse(readFileSync(usersFile, 'utf8')) : {};
    return Object.hasOwn(all, userId) ? all[userId] : null;
  };
  const { BedrockAgentCoreClient } = await import('@aws-sdk/client-bedrock-agentcore');
  const provider = process.env.MODEL_PROVIDER ?? 'amazon-bedrock';
  const models = createModels();
  models.setProvider(provider === 'amazon-bedrock' ? (await import('@earendil-works/pi-ai/providers/amazon-bedrock')).amazonBedrockProvider()
    : provider === 'anthropic' ? (await import('@earendil-works/pi-ai/providers/anthropic')).anthropicProvider()
      : (await import('@earendil-works/pi-ai/providers/openai')).openaiProvider());
  const app = await startAwsHost({
    port: Number(process.env.PORT ?? 8080), efsRoot, users, models, model: { provider, modelId: need('MODEL_ID') },
    // OIDC_JWKS (the key set inline) serves a VPC without internet egress; OIDC_JWKS_URL is fetched and refreshed on key rotation.
    verifyToken: createJwtVerifier({ issuer: need('OIDC_ISSUER'), audience: need('OIDC_AUDIENCE'),
      ...(process.env.OIDC_JWKS ? { jwks: JSON.parse(process.env.OIDC_JWKS) } : { jwksUrl: need('OIDC_JWKS_URL') }) }),
    // The task role supplies credentials through the default provider chain; nothing is configured here.
    codeInterpreter: { client: new BedrockAgentCoreClient({ region: process.env.REGION ?? need('AWS_REGION') }), identifier: need('CODE_INTERPRETER_ID') },
    requireSessionHeader: process.env.AGENTCORE === '1',
  });
  console.log(`AWS host on ${app.url} (EFS ${efsRoot}, ${process.env.AGENTCORE === '1' ? 'AgentCore Runtime' : 'ECS'} mode).`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().finally(() => process.exit(0)); });
}
