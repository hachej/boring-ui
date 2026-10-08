// Studio host: ONE standard agent (examples/shared/standard-agent.mjs) on a durable native Harness, behind a real HTTP socket.
// What differs between deployments is infrastructure only, supplied by variants (./variants/*.mjs): the execution environment,
// where resources are stored, the models, and whether it can run at all. Scenarios (./scenarios/*.mjs) are data the browser lists
// and the journey executes. Sessions live in SQLite and survive a restart. Fictional content only; the bearer token is a local
// fixture, not an identity provider.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { EFFORTS, configureOffered } from '../shared/conversation-host.mjs';
import { sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Harness, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { answerUserQuestion } from '@hachej/boring-agent/ask-user';
import { createGitTool } from '@hachej/boring-agent/git';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { conversationMetadata, createConversations, createConversationsHandler } from '@hachej/boring-agent/conversations';
import { createMentionResolver, safeMentionPath } from '@hachej/boring-agent/mentions';
import { createMeter, createSqliteLedger } from '@hachej/boring-agent/metering';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider, isTemporary } from '@hachej/boring-files/workspace';
import { createWorkspaceCache, rootConversation, withWorkspace } from '@hachej/boring-agent/workspaces';
import { createResourceHandler } from '@hachej/boring-files/remote';
import { withSubmitFaults } from '@hachej/boring-testing/network';
import { defineStandardAgent } from '../shared/standard-agent.mjs';
import { openPiStorage } from '../shared/pi-storage.mjs';
import { createCanvasTools } from '../shared/canvas-tools.mjs';
import { runCodeTool } from '../shared/codemode-tools.mjs';
import { createSubagents } from '../shared/subagent-tools.mjs';
import { connectMcpTools } from '../shared/mcp-tools.mjs';
import { readFiles, shell, writeFiles } from '../shared/workspace-tools.mjs';
import { buildTailwind } from './tailwind.mjs';
import { loadVariants } from './variants/index.mjs';
import { describeScenario, loadScenarios } from './scenarios/index.mjs';
import { isBinaryKind, kindOf, mediaTypeOf } from './file-types.mjs';
import { startChannels, whatsAppFromEnv } from './channels.mjs';

const PROVIDERS = {
  openai: async () => (await import('@earendil-works/pi-ai/providers/openai')).openaiProvider(),
  anthropic: async () => (await import('@earendil-works/pi-ai/providers/anthropic')).anthropicProvider(),
};
/** The models the composer offers; the last one is also what subagents run on. */
const DEFAULT_MODELS = {
  openai: [{ modelId: 'gpt-5-mini', label: 'GPT-5 mini' }, { modelId: 'gpt-5-nano', label: 'GPT-5 nano' }],
  anthropic: [{ modelId: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }],
};
const here = name => fileURLToPath(new URL(name, import.meta.url));
/** The workspace as the browser and the journeys see it, whatever directory a variant's environment really uses. */
const VIRTUAL_ROOT = '/workspace';
/**
 * Fictional credits of the variants that declare `credits: true` (local): every message holds `holdMicros` while it runs and is charged its
 * usage, priced by Pi's `calculateCost` from the model's rates with a 1.25 markup (@hachej/boring-agent/metering). One millionth is one micro.
 * A message to the scripted layer's fictional `premium` model holds `premiumHoldMicros`: below that balance it is refused while the
 * default model is still admitted (model-aware admission: the ledger sees the model each run will use).
 */
const CREDITS = { startMicros: 50_000_000, holdMicros: 20_000, premiumHoldMicros: 5_000_000, markup: 1.25 };
/** The scripted layer's costly fictional model (./scripted-model.mjs), offered in the composer next to the defaults. */
const PREMIUM = { modelId: 'premium', label: 'Premium (fictional)' };

export async function startStudio({ directory, port = 0, provider = process.env.STUDIO_PROVIDER ?? 'openai', models: modelOptions, modelsOverride, variants: only, token = randomUUID(), whatsapp = whatsAppFromEnv(),
  // Fixture bearer tokens of the fictional people of the `team` variant (each has their own workspace there); the default `token` is a
  // person of the team too. Local fixtures, not an identity provider.
  teamTokens = { 'fictional-user-a': randomUUID(), 'fictional-user-b': randomUUID() },
  // The deterministic test layer (./scripted-model.mjs): chosen by the host process only, never by a request. Absent unless STUDIO_MODEL=scripted or the caller asks.
  scripted = process.env.STUDIO_MODEL === 'scripted',
  // SQLite settings of the studio's files (workspace journal, Pi session, credits): unset, each file keeps its local-disk default
  // (WAL; full sync for the journal and credits, Pi's normal sync for the session); `sqliteSettings.networkFilesystem` from
  // @hachej/boring-files/sqlite when `directory` is on NFS such as EFS.
  sqlite,
  // Idle heartbeat of the chat watch stream (default 15 s). Behind a proxy or load balancer keep it under half the idle timeout.
  heartbeatMs = process.env.STUDIO_HEARTBEAT_MS ? Number(process.env.STUDIO_HEARTBEAT_MS) : undefined,
  // Test hook: the answer to a chat submit is held this long after the host handled it (the message is already recorded), like a slow
  // network. Also settable at run time through the returned `submitFaults` (journeys); `refuse` answers the next N submits with a refusal.
  submitDelayMs = Number(process.env.STUDIO_SUBMIT_DELAY_MS ?? 0) } = {}) {
  if (!directory) throw new Error('A data directory is required');
  mkdirSync(directory, { recursive: true });
  let models = modelsOverride, scriptMisses = [];
  if (scripted && !models) { provider = 'openai'; ({ models, misses: scriptMisses } = await (await import('./scripted-model.mjs')).createScriptedModels()); }
  if (!models) { models = createModels(); models.setProvider(await PROVIDERS[provider]()); }
  const configured = (modelOptions ?? DEFAULT_MODELS[provider] ?? []).map(model => ({ provider, ...model }));
  const offered = [...configured, ...(scripted && !modelOptions ? [{ provider, ...PREMIUM }] : [])];
  if (offered.length === 0) throw new Error(`No models are configured for provider ${provider}; pass { models: [{ modelId, label }] }`);

  const human = { scopeId: 'fictional-project', principalId: 'fictional-person', initiatorId: 'fictional-person' };
  const agentAccess = { scopeId: human.scopeId, principalId: 'fictional-agent', initiatorId: human.principalId };
  /** The person a request authenticates as: the default token is the studio's person, the team tokens are the team's other people. */
  function principalOf(request) {
    const header = request.headers.get('authorization');
    if (header === `Bearer ${token}`) return human.principalId;
    return Object.entries(teamTokens).find(([, value]) => header === `Bearer ${value}`)?.[0] ?? null;
  }
  /** A person of the team and their agent, as the workspace provider's principals (one scope per person). */
  // The studio person keeps their own identity (the page carries it); the other people get a scope each.
  const teamPerson = principal => principal === human.principalId ? human : { scopeId: `team-${principal}`, principalId: principal, initiatorId: principal };
  const teamAgent = principal => ({ scopeId: teamPerson(principal).scopeId, principalId: 'fictional-agent', initiatorId: principal });
  /**
   * The host's fictional vault: each person's credential for each connected service of the team variant. Tools ask for it per call
   * (`credentials` below); it never enters a conversation, a tool result or a log.
   */
  const vault = principal => ({ harbour: `fictional-harbour-token:${principal}` });
  const hostInfo = { provider, context, directory, models: offered, sqlite };
  let harness;
  const getHarness = () => { if (!harness) throw new Error('The harness is not open yet'); return harness; };
  const ok = result => { if (!result.ok) throw result.error; return result.value; };
  /** The text of a file, or `undefined` when it is binary: an image or PDF kind, a NUL byte, or bytes that are not UTF-8. */
  function decodeText(path, bytes) {
    if (isBinaryKind(path) || bytes.includes(0)) return undefined;
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return undefined; }
  }

  const readOf = (ws, path) => ws.files.read({ target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, ws.person);
  /** What `@path` mentions read: the person's view of the workspace through the variant's provider. */
  const mentionReader = (files, person) => async path => {
    if (!safeMentionPath(path)) return undefined;
    const read = await files.read({ target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, person);
    if (read.kind !== 'available') return undefined;
    return read.snapshot.bytes.byteLength > 5_000_000 ? { size: read.snapshot.bytes.byteLength } : { size: read.snapshot.bytes.byteLength, bytes: read.snapshot.bytes };
  };
  /** Creates a file that must not exist yet, through the provider. `false` when it does. */
  async function createFile(ws, path, bytes) {
    const published = await ws.files.publication.publish({ operationId: randomUUID(), atomicity: 'all-or-nothing',
      changes: [{ kind: 'create', target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, expected: { kind: 'absent' }, bytes, mediaType: mediaTypeOf(path) }] }, ws.person);
    if (published.kind === 'conflict') return false;
    if (published.kind !== 'committed') throw new Error(`The file could not be saved: ${published.reason ?? published.kind}`);
    return true;
  }

  // The workspace provider's journal (receipts, intents, retained versions) lives here, outside every workspace.
  const workspaceDb = openNodeConnection(join(directory, 'workspace.sqlite'), sqlite);
  const journal = createWorkspaceJournal(workspaceDb);

  // ---- Variants: infrastructure only. An unavailable one stays in the list with the reason.
  const descriptors = await loadVariants(hostInfo, only);
  const variants = new Map();
  /**
   * Which variant and person a conversation belongs to, from durable state: the owner its managed metadata names (`<agent id>` for a
   * variant of the studio's person, `<agent id>/<person>` for the team), read for the conversation a subagent's child belongs to.
   * The mapping never changes, so it is memoised.
   */
  const callers = new Map();
  async function callerOf(conversationId, callContext = context) {
    const known = callers.get(String(conversationId));
    if (known) return known;
    const root = await rootConversation(getHarness(), conversationId, callContext);
    const owner = (await getHarness().snapshot(conversationMetadata, root, callContext))?.owner ?? '';
    const [agentId, principal] = owner.split('/');
    const variant = [...variants.values()].find(candidate => candidate.agent.id === agentId);
    if (!variant || Boolean(variant.team) !== (principal !== undefined)) return undefined;
    const caller = { variant, principal: principal ?? human.principalId };
    callers.set(String(conversationId), caller);
    return caller;
  }
  /** The host's per-call credentials (`CredentialResolver`): the vault entry of the person who owns the conversation, team variant only. */
  const credentials = async (target, callContext, request) => {
    const caller = await callerOf(target.conversationId, callContext);
    return caller?.variant.team && request.server ? vault(caller.principal)[request.server] : undefined;
  };
  /** What the viewers of one workspace use: its resource handler (authenticated as the workspace's person only) and @mention reader. */
  const viewersOf = (ws, allowed) => ({ ...ws,
    resourceHandler: createResourceHandler({ authenticate: async request => allowed(principalOf(request)) ? ws.person : null, reader: ws.files, publisher: ws.files.publication, lookup: ws.files.reconciliation }),
    mentions: createMentionResolver({ read: mentionReader(ws.files, ws.person) }) });

  /** The workspace name of a person in a variant: the variant's one workspace, or the person's team workspace. */
  const workspaceName = (variant, principal = human.principalId) => variant.team ? `team-${principal}` : variant.id;
  /** The agent as a conversation of that workspace uses it: a self-evolving agent selects that workspace's own extension. */
  const agentOf = (variant, principal) => variant.agent.inWorkspace?.(workspaceName(variant, principal)) ?? variant.agent;
  /** Installs a workspace's self-evolution and rescans its `.agent/` (on open, before any of its conversations runs). */
  async function evolve(agent, env, callContext, label) {
    if (!agent.reload) return;
    agent.install(registry);
    const report = await agent.reload(env, callContext);
    if (report.errors.length) console.error(`.agent/ of ${label} on open:\n${report.text}`);
  }
  for (const descriptor of descriptors) {
    if (descriptor.available !== true) continue;
    const infra = await descriptor.open();
    const { root } = infra;
    const capabilities = new Set(descriptor.capabilities);
    const target = path => ({ resource: { providerId: 'workspace', path }, view: { kind: 'published' } });
    const canvasTarget = target('board.tldraw');
    // The workspace of each call comes with its env (`@hachej/boring-agent/workspaces`): the harness's `env` below is the one host function, and
    // every tool (guard, `present`, canvas, working_git, self-evolution) uses the workspace attached to the env Pi hands its call. A variant
    // with one workspace: one provider over its environment, the one way to read a workspace file by revision and to write it
    // conditionally (viewers, saves, uploads, `present`, and the documents the agent and the person share: notes.md and board.tldraw),
    // attached to that env. The team variant: one per person, opened on first use and closed when idle by a cache that attaches it.
    let single, team, variant;
    if (infra.workspace) {
      team = createWorkspaceCache({
        key: async (callTarget, callContext) => (await callerOf(callTarget.conversationId, callContext))?.principal,
        open: async (principal, openContext) => {
          const ws = viewersOf({ ...await infra.workspace(principal, openContext), access: teamAgent(principal), person: teamPerson(principal) }, candidate => candidate === principal);
          // The person's own `.agent/`: their extension, installed in the one registry and selected only by their conversations.
          await evolve(agentOf(variant, principal), ws.env, openContext, `${descriptor.id}/${principal}`);
          return ws;
        },
        idleMs: infra.idleMs,
        // Pi does not report when a call stops using its env: a workspace stays open while the harness has live work.
        busy: async () => (await getHarness().inspect(context)).tasks.length > 0,
        onError: error => console.error('team workspace close:', error?.message ?? error),
      });
    } else {
      const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: descriptor.id, incarnation: 'studio', viewId: 'published' }, fs: infra.env, journal });
      single = viewersOf({ id: descriptor.id, files, root, env: infra.env, access: agentAccess, person: human,
        ...(infra.repository ? { repository: infra.repository } : {}), ...(infra.routes ? { routes: infra.routes } : {}) }, candidate => candidate === human.principalId);
      withWorkspace(infra.env, single);
    }
    const subagents = createSubagents({ harness: getHarness, context, childModel: { provider, modelId: configured.at(-1).modelId }, childExtensions: capabilities.has('workspace') ? [readFiles] : [] });
    const parts = [
      ...(capabilities.has('workspace') ? [{ capabilities: ['workspace'], extensions: [readFiles, writeFiles] }] : []),
      ...(capabilities.has('shell') ? [{ capabilities: ['shell', ...(capabilities.has('python') ? ['python'] : [])], extensions: [shell] }] : []),
      ...(capabilities.has('git') && (infra.repository || team) ? [{ capabilities: ['git'], extensions: [defineExtension({ name: 'studio.git', tools: [createGitTool()] })] }] : []),
      { capabilities: ['canvas'], tools: createCanvasTools({ path: 'board.tldraw', namespace: `studio-${descriptor.id}-canvas-v1` }) },
      { capabilities: ['subagents'], tools: subagents.tools, extensions: subagents.extensions },
      { capabilities: ['codemode'], tools: [runCodeTool] },
    ];
    // MCP servers the variant names (off unless it does): their allowed tools become native tools of the agent (../shared/mcp-tools.mjs).
    // A `perPerson` server is reached with the credential of the person behind each call, from the host's vault.
    const mcp = [];
    for (const server of descriptor.mcp?.servers ?? []) mcp.push(await connectMcpTools({ ...server, ...(server.perPerson ? { credentials } : {}) }));
    if (mcp.length) parts.push({ capabilities: ['mcp'], tools: mcp.flatMap(connection => connection.tools) });
    const { agent, capabilities: all } = defineStandardAgent({ id: `standard-${descriptor.id}`, model: { provider, modelId: offered[0].modelId }, cwd: infra.cwd ?? root,
      workspace: 'env', parts, ...(descriptor.selfEvolving ? { selfEvolving: true } : {}) });
    // What the agent has, plus what the environment itself offers beyond tools (for example a remote sandbox's status tab), and the
    // conversation list's manage routes (rename, archive, fork, delete: `createConversationsHandler` below, every variant).
    variant = { id: descriptor.id, descriptor, infra, mcp, env: single?.env, files: single?.files, root, agent, capabilities: [...new Set([...all, ...descriptor.capabilities, 'conversation-management'])], single, team, subagents, notes: target('notes.md'), canvas: canvasTarget };
    variants.set(descriptor.id, variant);
  }
  if (variants.size === 0) throw new Error('No variant is available');
  const scenarios = await loadScenarios();
  const entries = [...variants.values()];
  const fallback = entries[0];
  const variantOf = request => variants.get(request.headers.get('x-studio-variant') ?? '') ?? fallback;
  /**
   * The workspace a viewer request uses, resolved from the authenticated person like a call's from its conversation: the variant's one
   * workspace (the studio's person only), or that person's team workspace, borrowed until `release` (which never closes it).
   */
  async function workspaceOfRequest(variant, principal) {
    if (variant.team) { const lease = await variant.team.acquire(principal, context); return { ws: lease.workspace, release: lease.release }; }
    return principal === human.principalId ? { ws: variant.single, release: () => {} } : undefined;
  }

  // Paths: the browser names workspace files `/workspace/<path>`; a variant's environment may keep them elsewhere.
  const virtual = (ws, path) => `${VIRTUAL_ROOT}${path.slice(ws.root.length)}`;
  const validPath = path => path.startsWith(`${VIRTUAL_ROOT}/`) && !path.split('/').includes('..');
  async function walk(ws, path = ws.root) {
    const files = [];
    for (const entry of ok(await ws.env.listDir(path, context)).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git' || isTemporary(entry.name)) continue;
      const child = `${path}/${entry.name}`;
      if (entry.kind === 'directory') files.push(...await walk(ws, child)); else if (entry.kind === 'file') files.push(child);
    }
    return files;
  }
  const toBytes = content => typeof content === 'string' ? new TextEncoder().encode(content) : content;
  /** Puts a scenario's files in the workspace (only those that are missing) and commits them when the variant has a repository. */
  async function seed(variant, ws, scenario) {
    const written = [];
    for (const [path, content] of Object.entries(scenario.seed ?? {})) if (await createFile(ws, path, toBytes(content))) written.push(path);
    if (written.length && scenario.seedCommit && ws.repository) { for (const path of written) await ws.repository.add(path); await ws.repository.commit(scenario.seedCommit); }
    return written;
  }

  // ---- Durable native sessions. Reopening the same file resumes unfinished work.
  const registry = createRegistry();
  for (const variant of entries) variant.agent.install(registry);
  // The environment of each use, from the conversation's durable owner: its variant's one workspace, or its person's team workspace (the
  // same cache entry the tools resolve). A conversation no variant owns (an unmanaged native fork) gets the default workspace, never a team one.
  const singles = entries.filter(variant => variant.single), byCwd = new Map(singles.map(variant => [variant.root, variant.env]));
  harness = await Harness.open(await openPiStorage(join(directory, 'session.sqlite'), sqlite), { registry, models,
    env: async (target, callContext) => {
      const caller = await callerOf(target.conversationId, callContext);
      if (caller) return caller.variant.team ? caller.variant.team.env(target, callContext) : caller.variant.env;
      return byCwd.get(target.cwd) ?? singles[0]?.env;
    } }, context);
  // The conversation list (title, last message, last activity, archived, deleted) is one native document per conversation
  // (`@hachej/boring-agent/conversations`), kept by Pi with the transcript. A conversation's owner is its variant's agent.
  const managed = createConversations({ harness, context, onError: error => console.error('conversation metadata:', error?.message ?? error) });
  // The live handles the chat transport serves (deleted ones are dropped), and the variant and person each belongs to.
  const conversations = new Map(), variantOfConversation = new Map(), principalOfConversation = new Map();
  /** The owner key of the conversations of a variant for a person: the agent id, and for the team the person too. */
  const ownerKey = (variant, principal = human.principalId) => variant.team ? `${variant.agent.id}/${principal}` : variant.agent.id;
  const register = (variant, conversation, principal = human.principalId) => {
    conversations.set(String(conversation.id), conversation); variantOfConversation.set(String(conversation.id), variant); principalOfConversation.set(String(conversation.id), principal);
  };
  async function create(variant, principal = human.principalId) {
    const conversation = await managed.create(ownerKey(variant, principal), { start: init => agentOf(variant, principal).createConversation(harness, context, { init }) });
    register(variant, conversation, principal);
    return conversation;
  }
  /** A person's conversations of the team variant are loaded on their first request (the host does not list every person at start). */
  const loadedTeams = new Set();
  async function loadTeamConversations(variant, principal) {
    const key = ownerKey(variant, principal);
    if (loadedTeams.has(key)) return;
    let cursor;
    do {
      const page = await managed.list({ owner: key, archived: 'all', limit: 200, ...(cursor ? { cursor } : {}) });
      for (const item of page.items) { const found = await harness.conversation(item.id, context); if (found) register(variant, found, principal); }
      cursor = page.next;
    } while (cursor);
    if (![...variantOfConversation].some(([id, owner]) => owner === variant && principalOfConversation.get(id) === principal)) await create(variant, principal);
    loadedTeams.add(key);
  }
  // Dev data of earlier studio versions: its own index and activity files are read once, their conversations adopted, then set aside.
  const legacyIndex = join(directory, 'conversations.json'), legacyActivity = join(directory, 'conversation-activity.json');
  if (existsSync(legacyIndex)) {
    const index = JSON.parse(readFileSync(legacyIndex, 'utf8'));
    const activity = existsSync(legacyActivity) ? JSON.parse(readFileSync(legacyActivity, 'utf8')) : {};
    for (const [owner, ids] of Object.entries(index)) for (const id of ids) await managed.adopt(id, owner, activity[String(id)] ? { updatedAt: activity[String(id)] } : {});
    renameSync(legacyIndex, `${legacyIndex}.migrated`);
    if (existsSync(legacyActivity)) renameSync(legacyActivity, `${legacyActivity}.migrated`);
  }
  for (const variant of singles) {
    let cursor;
    do {
      const page = await managed.list({ owner: variant.agent.id, archived: 'all', limit: 200, ...(cursor ? { cursor } : {}) });
      for (const item of page.items) { const found = await harness.conversation(item.id, context); if (found) register(variant, found); }
      cursor = page.next;
    } while (cursor);
    if (![...variantOfConversation.values()].includes(variant)) await create(variant);
  }
  // The History list's operations (list and search, create, rename, archive, delete, fork), scoped to the variant's agent.
  for (const variant of entries) variant.conversationsHandler = createConversationsHandler({ conversations: managed, authenticate: async request => {
    const principal = principalOf(request);
    if (principal === null || (!variant.team && principal !== human.principalId)) return null;
    return {
      owner: ownerKey(variant, principal), start: init => agentOf(variant, principal).createConversation(harness, context, { init }),
      opened: conversation => register(variant, conversation, principal),
      deleted: async id => {
        conversations.delete(String(id)); variantOfConversation.delete(String(id)); principalOfConversation.delete(String(id));
        if (![...variantOfConversation].some(([other, owner]) => owner === variant && principalOfConversation.get(other) === principal)) await create(variant, principal);
      },
    };
  } });
  // A self-evolving agent's `.agent/` lives in its workspace: the same scan as `reload` reinstalls it before any conversation resumes.
  // A team person's is installed when their workspace opens; the workspaces of conversations with live work open before they resume.
  for (const variant of singles) await evolve(agentOf(variant), variant.env, context, variant.id);
  for (const task of (await harness.inspect(context)).tasks) {
    const caller = await callerOf(task.record.conversationId).catch(() => undefined);
    if (caller?.variant.team) (await caller.variant.team.acquire(caller.principal, context)).release();
  }
  // Metering: the ledger is a SQLite file of the host; runs a previous process left open are finished from Pi's durable state.
  const creditsDb = openNodeConnection(join(directory, 'credits.sqlite'), sqlite);
  const premium = input => input.model?.id === PREMIUM.modelId;
  const ledger = createSqliteLedger({ connection: creditsDb, holdMicros: input => premium(input) ? CREDITS.premiumHoldMicros : CREDITS.holdMicros,
    refusal: (available, hold, input) => `Not enough credits ${premium(input) ? 'for the premium model' : 'to send this message'}: ${(Math.max(0, available) / 1e6).toFixed(4)} available, a message needs ${(hold / 1e6).toFixed(4)}.` });
  await ledger.grant(human.principalId, CREDITS.startMicros, 'studio-start');
  const meter = createMeter({ sink: ledger, context, models, markup: CREDITS.markup });
  await meter.recover(harness);
  harness.resume();
  // External channels (WhatsApp) when configured: same harness and conversations, own signed webhook instead of the bearer token.
  const channelEntries = singles.map(variant => ({ ...variant, agent: variant.agent }));
  const channels = whatsapp ? startChannels({ directory, harness, context, agents: channelEntries, conversations, create: entry => create(variants.get(entry.id)), whatsapp }) : undefined;
  await channels?.start();

  const chat = createChatTransportHandler({ ...(heartbeatMs === undefined ? {} : { heartbeatMs }), authenticate: async request => {
    const principal = principalOf(request);
    const id = new URL(request.url).searchParams.get('conversation') ?? '';
    if (principal === null || !/^\d+$/.test(id)) return null;
    // A person's team conversations may not be loaded yet after a restart: their durable owner says whose they are.
    if (!conversations.has(id)) {
      const caller = await callerOf(Number(id)).catch(() => undefined);
      if (caller?.variant.team && caller.principal === principal) await loadTeamConversations(caller.variant, principal);
    }
    const conversation = conversations.get(id);
    if (!conversation || principalOfConversation.get(id) !== principal) return null;
    const owner = variantOfConversation.get(id);
    // Every message sees what the person attached or @mentioned: the host reads the workspace and adds the files to the input.
    // In a variant with credits a message is reserved against the person's balance before it reaches the conversation (or refused):
    // the host maps its authentication to the metering scope (the person, the variant's workspace, a fictional plan).
    const scope = { userId: principal, workspaceId: owner.team ? `${owner.descriptor.id}/${principal}` : owner.descriptor.id, attributes: { plan: 'fictional-free' } };
    // @mentions read the conversation's own workspace, borrowed for the read only.
    const prepareInput = async input => {
      const borrowed = await workspaceOfRequest(owner, principal);
      try { return await borrowed.ws.mentions(input); } finally { borrowed.release(); }
    };
    return { conversation: owner.descriptor.credits ? meter.conversation(conversation, scope) : conversation, context, prepareInput, abortSubmission: id => harness.abortSubmission(id, context, conversation.id),
      answer: (callId, answer) => answerUserQuestion(conversation, callId, answer, context), configure: change => configure(conversation, change) };
  } });
  // The host owns the allow-list: a change outside the declared models and efforts is refused, not applied.
  const configure = (conversation, change) => configureOffered(conversation, change, context, model => offered.some(item => item.provider === model.provider && item.modelId === model.modelId));
  const describeVariant = (descriptor, variant, principal = human.principalId, agent = variant && agentOf(variant, principal)) => ({
    id: descriptor.id, title: descriptor.title, description: descriptor.description, available: variant !== undefined,
    ...(descriptor.available === true ? {} : { reason: descriptor.available.reason }), ...(descriptor.link ? { link: descriptor.link } : {}),
    ...(variant ? {
      agent: agent.id, model: `${agent.agent.model.provider}/${agent.agent.model.modelId}`, capabilities: variant.capabilities, skills: agent.skills,
      selfEvolving: Boolean(agent.reload),
      tools: agent.extensions.flatMap(extension => (extension.tools ?? []).map(tool => tool.name)),
      chat: { models: offered.map(model => ({ provider: model.provider, modelId: model.modelId, label: model.label })), efforts: EFFORTS },
      notes: variant.notes, canvas: variant.canvas,
      conversations: [...variantOfConversation].filter(([id, owner]) => owner === variant && principalOfConversation.get(id) === principal).map(([id]) => Number(id)).sort((a, b) => a - b),
    } : {}),
  });
  /** What the browser lists. The team's other people see only the team variant, with their own conversations. */
  // `identity`: who the token is, as the page's resource clients and chat name it (the studio's person, or a team person's own scope).
  const describe = (principal = human.principalId) => ({ identity: { runtimeId: 'studio', ...teamPerson(principal) },
    variants: descriptors.filter(descriptor => principal === human.principalId || variants.get(descriptor.id)?.team).map(descriptor => describeVariant(descriptor, variants.get(descriptor.id), principal)),
    scenarios: scenarios.map(describeScenario) });

  async function api(request, url) {
    const principal = principalOf(request);
    if (principal === null) return Response.json({ reason: 'authentication-required' }, { status: 401 });
    if (request.method === 'GET' && url.pathname === '/api/studio') {
      for (const variant of entries) if (variant.team) await loadTeamConversations(variant, principal);
      return Response.json(describe(principal));
    }
    const listed = /^\/api\/variants\/([a-z0-9._-]+)\/conversations$/.exec(url.pathname);
    // The History list: the variant's conversations, newest activity first (`@hachej/boring-agent/conversations`).
    if (listed) {
      const target = variants.get(listed[1]);
      if (!target) return Response.json({ reason: 'unknown-variant' }, { status: 404 });
      return target.conversationsHandler(request);
    }
    const variant = variantOf(request);
    const borrowed = await workspaceOfRequest(variant, principal);
    if (!borrowed) return Response.json({ reason: 'not-authorized' }, { status: 403 });
    try { return await workspaceApi(request, url, variant, borrowed.ws, principal); } finally { borrowed.release(); }
  }
  /** The routes of one workspace: the variant's, or the requesting person's team workspace. */
  async function workspaceApi(request, url, variant, ws, principal) {
    if (url.pathname === '/api/resources') return ws.resourceHandler(request);
    // The person's fictional credits; POST tops them back up to the starting balance (the stand-in for buying more), or sets them to
    // `{ balanceMicros }` (a fixture for the low-balance scenario).
    if (url.pathname === '/api/credits' && principal === human.principalId) {
      if (request.method === 'POST') {
        const wanted = Number((await request.json().catch(() => ({})))?.balanceMicros ?? CREDITS.startMicros);
        if (!Number.isSafeInteger(wanted) || wanted < 0 || wanted > CREDITS.startMicros) return Response.json({ reason: 'invalid-balance' }, { status: 400 });
        const { balanceMicros } = await ledger.balance(human.principalId);
        await ledger.grant(human.principalId, wanted - balanceMicros, `top-up-${randomUUID()}`);
      }
      return Response.json({ ...await ledger.balance(human.principalId), holdMicros: CREDITS.holdMicros, premiumHoldMicros: CREDITS.premiumHoldMicros, variants: entries.filter(entry => entry.descriptor.credits).map(entry => entry.id) });
    }
    if (request.method === 'GET' && url.pathname === '/api/files') return Response.json({ files: (await walk(ws)).map(path => virtual(ws, path)) });
    // The retained versions of one workspace file (relative path) with their save times, newest first: the version list of a presented file.
    if (request.method === 'GET' && url.pathname === '/api/history') return Response.json({ saves: ws.files.saves(url.searchParams.get('path') ?? '') });
    if (request.method === 'GET' && url.pathname === '/api/file') {
      const path = url.searchParams.get('path') ?? '';
      if (!validPath(path)) return Response.json({ reason: 'invalid-path' }, { status: 400 });
      const found = await readOf(ws, path.slice(VIRTUAL_ROOT.length + 1));
      if (found.kind !== 'available') return Response.json({ reason: 'not-found' }, { status: 404 });
      const read = { value: found.snapshot.bytes };
      const mediaType = mediaTypeOf(path);
      // `raw=1` returns the bytes with their content type, for the image and PDF viewers. The sandbox policy keeps a stored SVG or
      // HTML file inert even if its URL were opened directly.
      if (url.searchParams.get('raw') === '1') return new Response(read.value, { headers: { 'content-type': mediaType, 'content-length': String(read.value.byteLength),
        'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', 'cache-control': 'no-store' } });
      const text = decodeText(path, read.value);
      return Response.json({ path, kind: kindOf(path), mediaType, size: read.value.byteLength, ...(text === undefined ? {} : { text }) });
    }
    if (request.method === 'GET' && url.pathname === '/api/search') {
      const needle = (url.searchParams.get('q') ?? '').toLowerCase();
      const paths = (await walk(ws)).map(path => virtual(ws, path).slice(VIRTUAL_ROOT.length + 1));
      const rank = path => path.split('/').pop().toLowerCase().includes(needle) ? 0 : 1;
      return Response.json({ results: paths.filter(path => path.toLowerCase().includes(needle)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, 8).map(path => ({ path, kind: 'file' })) });
    }
    // One file per request, always saved under uploads/ (so it survives a restart and opens in the Files tab).
    if (request.method === 'POST' && url.pathname === '/api/upload') {
      const name = (url.searchParams.get('name') ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 80);
      const mimeType = request.headers.get('content-type') ?? 'application/octet-stream';
      if (!name) return Response.json({ reason: 'invalid-name' }, { status: 400 });
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > 5_000_000) return Response.json({ reason: bytes.byteLength ? 'file-too-large' : 'file-is-empty' }, { status: 413 });
      let saved = name;
      for (let n = 2; !await createFile(ws, `uploads/${saved}`, bytes); n++) saved = name.replace(/(\.[^.]*)?$/, suffix => `-${n}${suffix}`);
      // An image is also handed back as base64 for the chat to attach; the file is kept either way.
      return Response.json({ name: saved, path: `uploads/${saved}`, ...(mimeType.startsWith('image/') ? { image: { data: Buffer.from(bytes).toString('base64'), mimeType } } : {}) });
    }
    // A scenario's files and its upload fixtures.
    const scenarioRoute = /^\/api\/scenarios\/([a-z0-9-]+)\/(seed|fixture\/(\d+))$/.exec(url.pathname);
    if (scenarioRoute) {
      const scenario = scenarios.find(candidate => candidate.id === scenarioRoute[1]);
      if (!scenario) return Response.json({ reason: 'unknown-scenario' }, { status: 404 });
      if (request.method === 'POST' && scenarioRoute[2] === 'seed') return Response.json({ written: await seed(variant, ws, scenario) });
      const upload = scenario.steps[Number(scenarioRoute[3])]?.upload;
      if (request.method === 'GET' && upload) return new Response(toBytes(upload.content), { headers: { 'content-type': upload.mimeType ?? mediaTypeOf(upload.name), 'content-disposition': `attachment; filename="${upload.name}"` } });
      return Response.json({ reason: 'not-found' }, { status: 404 });
    }
    // The Tasks tab: the child conversations of the open conversation (background subagents among them).
    if (request.method === 'GET' && url.pathname === '/api/tasks') {
      const parent = Number(url.searchParams.get('conversation'));
      if (principalOfConversation.get(String(parent)) !== principal) return Response.json({ reason: 'unknown-conversation' }, { status: 404 });
      const found = await variant.subagents.describe(parent, variant.agent.id);
      return found ? Response.json(found) : Response.json({ reason: 'unknown-conversation' }, { status: 404 });
    }
    // The person's `/reload`: the same function as the agent's `reload` tool, over the person's own workspace environment.
    if (request.method === 'POST' && url.pathname === '/api/reload') {
      const agent = agentOf(variant, principal);
      if (!agent.reload) return Response.json({ reason: 'not-self-evolving' }, { status: 404 });
      const report = await agent.reload(ws.env, context);
      return Response.json({ text: report.text, report });
    }
    // The workspace's own extra endpoints (the Git and Sandbox tabs): the variant's, or the requesting person's team workspace's.
    if (ws.routes) { const response = await ws.routes(request, url); if (response) return response; }
    return Response.json({ reason: 'not-found' }, { status: 404 });
  }

  // ---- The browser app: one bundle, compiled once at startup.
  const bundle = await build({ entryPoints: [here('./browser.jsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', platform: 'browser', jsx: 'automatic',
    loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  // CSS imported by a panel (for example a viewer's stylesheet) is bundled and served with the studio styles.
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  // Tailwind is compiled once here: the shadcn tokens (the registry `theme` item) and the utilities used by the registry items and this folder.
  const tailwind = await buildTailwind();
  const styles = [tailwind, ...bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text), readFileSync(here('./styles.css'), 'utf8')].join('\n');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><title>Boring studio (fictional)</title>
<link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div>
<script>window.__STUDIO__=${JSON.stringify({ token, identity: { runtimeId: 'studio', ...human } })}</script>
<script type="module" src="/app.js"></script></body></html>`;
  const statics = { '/': ['text/html; charset=utf-8', page], '/app.js': ['text/javascript; charset=utf-8', script], '/styles.css': ['text/css; charset=utf-8', styles] };

  const watches = { open: 0, peak: 0, total: 0 };
  /** The chat transport behind the submit test hook (@hachej/boring-testing/network): a delayed confirmation, or a 402 `submission-refused` that never reaches the conversation. */
  const { handler: chatWithFaults, faults: submitFaults } = withSubmitFaults(chat, { delayMs: submitDelayMs, message: 'Fictional refusal (studio test hook)' });
  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    const closed = new AbortController();
    outgoing.on('close', () => closed.abort());
    // Debug counter for journeys (not a route): concurrent chat watch streams, which share the browser's per-host connection pool.
    if (url.pathname === '/api/chat' && url.searchParams.get('op') === 'watch') { watches.open++; watches.total++; watches.peak = Math.max(watches.peak, watches.open); outgoing.on('close', () => { watches.open--; }); }
    try {
      const fixed = incoming.method === 'GET' && statics[url.pathname];
      if (fixed) return void outgoing.writeHead(200, { 'content-type': fixed[0], 'cache-control': 'no-store' }).end(fixed[1]);
      const request = await webRequest(incoming, url, { signal: closed.signal });
      if (!request) return void outgoing.writeHead(413).end();
      const channel = channels && Object.hasOwn(channels.routes, url.pathname) ? channels.routes[url.pathname] : undefined;
      const response = channel ? await channel(request) : url.pathname === '/api/chat' ? await chatWithFaults(request)
        : await api(request, url);
      await sendWebResponse(response, outgoing, { signal: closed.signal });
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
      if (!closed.signal.aborted) console.error('request failed:', error?.message ?? error);
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`, port: server.address().port, token, teamTokens, provider, scripted, scriptMisses, channels: channels ? { whatsapp: channels.agent } : {},
    /** The variants as the browser sees them, with availability. */
    watches, submitFaults, variants: () => describe().variants, scenarios: () => scenarios, agents: () => entries.map(variant => describeVariant(variant.descriptor, variant)),
    harness, conversations, files: singles[0]?.single.files, host: { ...hostInfo, agentAccess, env: singles[0]?.env, variants },
    persist: async () => { for (const variant of entries) await variant.infra.persist?.(); },
    close: async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await channels?.close();
      await meter.close();
      await managed.dispose();
      await harness.close(context);
      creditsDb.close();
      for (const variant of entries) { for (const connection of variant.mcp) await connection.close(); await variant.team?.close(); await variant.infra.close?.(); }
      workspaceDb.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startStudio({ directory: process.env.STUDIO_DATA ?? '.cache/studio', port: Number(process.env.PORT ?? 4180) });
  const unavailable = app.variants().filter(variant => !variant.available);
  console.log(`Studio on ${app.url} (${app.provider}). Variants: ${app.variants().filter(variant => variant.available).map(variant => variant.id).join(', ')}${unavailable.length ? `; unavailable: ${unavailable.map(variant => `${variant.id} (${variant.reason})`).join('; ')}` : ''}. Fictional content only. Data in ${process.env.STUDIO_DATA ?? '.cache/studio'}.`);
  if (app.channels.whatsapp) console.log(`WhatsApp webhook: ${app.url}api/channels/whatsapp -> agent ${app.channels.whatsapp}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().finally(() => process.exit(0)); });
}
