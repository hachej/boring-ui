// The bot: one lifelong personal assistant (an "Instinct-like" chatbot) on the durable native Harness.
// - Memory is OptChat, from `@hachej/boring-agent/memory/optchat`: the native transcript is the append-only log and the
//   package's extension shows the model a view of everything before the current turn (one summary line per tree node)
//   with zoom/date to reach back to the exact words. The bot opts its one conversation in with `configure`; summaries
//   are made after each answer and stored in a conversation document. Native compaction is declined while it is on.
// - Code mode: run_code (upstream pi-codemode) is how the bot computes, searches its memory and uses its abilities.
// - Self-modification (./self.mjs): the bot edits its persona and sandboxed abilities under /workspace/self and calls
//   redeploy. The host validates the files and installs a replacement native extension under the same name; the same
//   conversation resumes with the new self from its next request. Versions roll back from the panel.
import { join } from 'node:path';
import { defineExtension, defineTool, section } from '@earendil-works/pi-durable';
import { createEditTool, createReadTool, createWriteTool } from '@earendil-works/pi-durable/tools';
import { Type } from '@earendil-works/pi-ai';
import { defineAgent } from '@hachej/boring-agent/agents';
import { createOptChatMemory } from '@hachej/boring-agent/memory/optchat';
import { LIMITS, SELF_DIR, SELF_SEED, checkAbilities, declarations, describeChange, openDeploys, parseAbility, runSandboxed } from './self.mjs';

/**
 * host: { context, env (the workspace ExecutionEnv), directory (host data), models, model: { provider, modelId },
 * napModel?: { provider, modelId }, memory?: OptChat options (nodeBytes, viewBytes, ...), harness (getter, valid once open) }.
 * Returns the native agent, the memory handle, `install(registry)` (keeps the registry for redeploys), `optIn(conversation)`
 * and the panel's HTTP routes under /api/bot/.
 */
export async function createBot(host) {
  const { context } = host;
  const ok = result => { if (!result.ok) throw result.error; return result.value; };
  const env = host.env;

  // Seed the editable self once; after that the files belong to the companion (and the person).
  for (const [path, text] of Object.entries(SELF_SEED)) {
    if (ok(await env.exists(path, context))) continue;
    ok(await env.createDir(path.slice(0, path.lastIndexOf('/')), { recursive: true }, context));
    ok(await env.writeFile(path, new TextEncoder().encode(text), context));
  }
  async function readSelf() {
    const persona = ok(await env.readTextFile(`${SELF_DIR}/persona.md`, context));
    if (persona.length > LIMITS.persona) throw new Error(`persona.md exceeds ${LIMITS.persona} characters`);
    const listed = ok(await env.exists(`${SELF_DIR}/abilities`, context)) ? ok(await env.listDir(`${SELF_DIR}/abilities`, context)) : [];
    const files = listed.filter(entry => entry.kind === 'file' && entry.name.endsWith('.js')).sort((a, b) => a.name.localeCompare(b.name));
    if (files.length > LIMITS.abilities) throw new Error(`At most ${LIMITS.abilities} abilities`);
    const abilities = [];
    for (const file of files) abilities.push(parseAbility(file.name.slice(0, -3), ok(await env.readTextFile(`${SELF_DIR}/abilities/${file.name}`, context))));
    return { persona, abilities };
  }

  /** Put a deployed version back into the files, so the source and the running self agree again. */
  async function writeSelf({ persona, abilities }) {
    const write = async (path, text) => ok(await env.writeFile(path, new TextEncoder().encode(text), context));
    await write(`${SELF_DIR}/persona.md`, persona);
    ok(await env.createDir(`${SELF_DIR}/abilities`, { recursive: true }, context));
    const keep = new Set(abilities.map(ability => `${ability.name}.js`));
    for (const entry of ok(await env.listDir(`${SELF_DIR}/abilities`, context))) if (entry.kind === 'file' && entry.name.endsWith('.js') && !keep.has(entry.name)) ok(await env.remove(`${SELF_DIR}/abilities/${entry.name}`, {}, context));
    for (const ability of abilities) await write(`${SELF_DIR}/abilities/${ability.name}.js`, ability.body);
  }

  // ---- OptChat memory -------------------------------------------------------------------------------------------
  const memory = createOptChatMemory({
    harness: () => host.harness, context, agentName: 'the assistant', ...host.memory,
    summarizer: { models: host.models, model: host.napModel ?? host.model },
  });

  // ---- The editable self ----------------------------------------------------------------------------------------
  const deploys = openDeploys(join(host.directory, 'deploys.json'));
  if (!deploys.current) deploys.append({ ...await readSelf(), change: 'first version', note: 'seed' });

  const inSelf = path => { const full = String(path ?? '').startsWith('/') ? String(path) : `${SELF_DIR}/${path}`; if ((!full.startsWith(`${SELF_DIR}/`) && full !== SELF_DIR) || full.includes('..')) throw new Error(`Only ${SELF_DIR} is reachable from code`); return full; };
  const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
  /** The tools a sandboxed script may call; every one is host code bound to the calling conversation. */
  const sandboxTools = conversationId => [
    { name: 'today', args: '{}', description: 'The current date and time (ISO).', inputSchema: object({}),
      execute: () => { const now = new Date(); return { date: now.toISOString().slice(0, 10), time: now.toISOString() }; } },
    { name: 'zoom', args: '{ id: number, n: number }', description: 'Open memory line id+n into its two lines; n = 1 returns message id whole.', inputSchema: object({ id: { type: 'integer' }, n: { type: 'integer' } }),
      execute: ({ id, n }) => memory.zoom(conversationId, id, n) },
    { name: 'list_files', args: '{ path?: string }', description: `List a directory under ${SELF_DIR}.`, inputSchema: object({ path: { type: 'string' } }, []),
      execute: async ({ path }) => ok(await env.listDir(inSelf(path ?? SELF_DIR), context)).map(entry => `${entry.kind === 'directory' ? 'dir ' : 'file'} ${entry.name}`) },
    { name: 'read_file', args: '{ path: string }', description: `Read a text file under ${SELF_DIR}.`, inputSchema: object({ path: { type: 'string' } }),
      execute: async ({ path }) => ok(await env.readTextFile(inSelf(path), context)) },
    { name: 'write_file', args: '{ path: string, text: string }', description: `Write a text file under ${SELF_DIR} (e.g. notes/groceries.md).`, inputSchema: object({ path: { type: 'string' }, text: { type: 'string' } }),
      execute: async ({ path, text }) => { const full = inSelf(path); ok(await env.createDir(full.slice(0, full.lastIndexOf('/')), { recursive: true }, context)); ok(await env.writeFile(full, new TextEncoder().encode(String(text)), context)); return `wrote ${full}`; } },
  ];
  const HOST_TOOLS = sandboxTools(undefined).map(({ name, args, description }) => ({ name, args, description }));
  const runs = { executions: 0, failed: 0 };

  /** The native extension for one deployed version. Same name every time, so installing it replaces the previous one. */
  function selfExtension(version) {
    const runCode = defineTool({
      name: 'run_code',
      description: `Run JavaScript in an isolated sandbox (self v${version.version}). The code is an async function body: await and return work.
Call host tools as \`await tools.<name>(args)\` and your own abilities as \`await abilities.<name>(args)\`. Print with text(value) or return a value.
No timers, fetch, require or network. Limits: ${LIMITS.timeoutMs / 1000} s, ${LIMITS.nestedCalls} tool calls, ${LIMITS.outputChars} output characters.
${declarations(HOST_TOOLS, version.abilities)}`,
      parameters: Type.Object({ code: Type.String({ description: 'JavaScript async function body.' }) }, { additionalProperties: false }),
      replay: 'safe',
      execute: async ({ code }, api, callContext) => {
        const result = await runSandboxed(code, version.abilities, sandboxTools(api.conversationId), callContext.abortSignal);
        runs.executions += 1; if (result.isError) runs.failed += 1;
        return { content: [{ type: 'text', text: result.text }], isError: result.isError };
      },
    });
    return defineExtension({
      name: 'bot.self', tools: [runCode],
      sections: [section('persona', () => `${version.persona.trim()}\n\n(Self version ${version.version}, deployed ${version.at}. Source: ${SELF_DIR}.)`)],
    });
  }

  let registry;
  function deploy(snapshot, note) {
    const entry = deploys.append({ ...snapshot, change: describeChange(deploys.current, snapshot), note: String(note ?? '').slice(0, 200) });
    registry?.install(selfExtension(entry));
    return entry;
  }
  const redeploy = defineTool({
    name: 'redeploy',
    description: `Deploy your current self from ${SELF_DIR} (persona.md and abilities/*.js) as a new version. The host checks every file first; on success the next model request of this same conversation uses the new persona and abilities. Edit the files first, then call this once.`,
    parameters: Type.Object({ note: Type.String({ description: 'One line: what changed and why.' }) }, { additionalProperties: false }),
    execute: async ({ note }) => {
      let snapshot;
      try { snapshot = await readSelf(); } catch (error) { return { content: [{ type: 'text', text: `Not deployed: ${error.message}` }], isError: true }; }
      const problems = await checkAbilities(snapshot.abilities);
      if (problems.length) return { content: [{ type: 'text', text: `Not deployed; fix these first:\n${problems.join('\n')}` }], isError: true };
      const change = describeChange(deploys.current, snapshot);
      if (change === 'no change') return { content: [{ type: 'text', text: `Nothing to deploy: the files match v${deploys.current.version}.` }] };
      const entry = deploy(snapshot, note);
      return { content: [{ type: 'text', text: `Deployed self v${entry.version} (${entry.change}). It takes effect from your next request in this same conversation.` }] };
    },
  });

  const files = defineExtension({ name: 'bot.files', tools: [createReadTool(), createWriteTool(), createEditTool()] });
  const agent = defineAgent({
    id: 'bot', model: host.model,
    extensions: [selfExtension(deploys.current), defineExtension({ name: 'bot.deploy', tools: [redeploy] }), files],
    instructions: `You are a lifelong personal assistant in a fictional demo. This is one conversation that never ends.
Memory: each user message starts with a <chat> view: your compressed record of everything said before it, one line per stretch of messages. Trust it, and when a detail matters (a name, a number, a promise), use zoom to get the exact words instead of guessing. Never mention the mechanics unless asked.
Self: your persona and abilities live in ${SELF_DIR}. When you learn a durable fact about the person, update the "About the person" section of persona.md. When a request would be easier with a reusable ability, write it as ${SELF_DIR}/abilities/<name>.js (see ${SELF_DIR}/README.md), then call redeploy and use it through run_code. Use absolute paths.
Use run_code for dates, arithmetic, lists and anything multi-step. Keep replies short.`,
  });

  const selected = async conversation => (await conversation.agent(context)).extensions.some(extension => extension.name === memory.extension.name);
  async function state(id) {
    let memoryState = null, drift;
    const conversation = id === undefined ? undefined : await host.harness.conversation(id, context);
    if (conversation) memoryState = { conversationId: id, enabled: await selected(conversation), ...await memory.stats(id) };
    try { drift = describeChange(deploys.current, await readSelf()); } catch (error) { drift = `unreadable: ${error.message}`; }
    const { persona, abilities, ...current } = deploys.current;
    return { runs, memory: memoryState,
      self: { current: { ...current, persona, abilities: abilities.map(({ name, description, args }) => ({ name, description, args })) }, drift,
        versions: deploys.versions.map(({ version, at, change, note }) => ({ version, at, change, note })).reverse() } };
  }

  return {
    agent,
    memory,
    install: target => { registry = target; agent.install(target); target.install(memory.extension); },
    /** OptChat is opt-in per conversation: select its extension (and only that) with the native `configure`. Safe to repeat. */
    optIn: conversation => conversation.configure({ extensions: { add: [memory.extension] } }, context),
    dispose: () => memory.dispose(),
    /** Panel endpoints for one conversation: GET state, POST rollback?version=n, POST nap. */
    routes: async (request, url, conversationId) => {
      if (request.method === 'GET' && url.pathname === '/api/bot/state') return Response.json(await state(conversationId));
      if (request.method === 'POST' && url.pathname === '/api/bot/rollback') {
        const target = deploys.find(Number(url.searchParams.get('version')));
        if (!target) return Response.json({ reason: 'unknown-version' }, { status: 404 });
        await writeSelf(target);
        const entry = deploy({ persona: target.persona, abilities: target.abilities }, `rollback to v${target.version}`);
        return Response.json({ version: entry.version });
      }
      if (request.method === 'POST' && url.pathname === '/api/bot/nap') { await memory.nap(conversationId); return Response.json({ ok: true }); }
    },
  };
}
